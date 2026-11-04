// The command of the Lambda functions (deploy/aws/lambda.tf). The configuration is read from the
// Parameter Store first, because the app reads it as its modules load; then the same server the
// EC2 runs starts on port 3001, and the Lambda Web Adapter in the image sends each invocation to it.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { loadParameters } from "./env";

// The image is read-only on Lambda, and Mastra writes into the agent overrides folder as it runs
// (src/mastra/index.ts): it gets a copy in /tmp, the only writable place, with whatever overrides
// the image carries. Nothing written there outlives the instance, which is what the EC2 container
// did too: the overrides that count are the ones in the repository.
function writableEditorDir(): string {
  const target = "/tmp/mastra-editor";
  const source = path.join(process.cwd(), "dist", "mastra", "editor");
  mkdirSync(target, { recursive: true });
  if (existsSync(source)) cpSync(source, target, { recursive: true });
  return target;
}

async function start() {
  const path = process.env.ARGON_SSM_PATH;
  if (!path) throw new Error("ARGON_SSM_PATH is not set: the function does not know its environment");
  await loadParameters(path);
  process.env.MASTRA_EDITOR_DIR ??= writableEditorDir();
  await import("../main");
}

start().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
