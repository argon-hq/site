// The command of the Lambda functions (deploy/aws/lambda.tf). The configuration is read from the
// Parameter Store first, because the app reads it as its modules load; then the same server
// `pnpm dev` runs starts on port 3001, and the Lambda Web Adapter in the image sends each
// invocation to it.
import { loadParameters } from "./env";

async function start() {
  const path = process.env.ARGON_SSM_PATH;
  if (!path) throw new Error("ARGON_SSM_PATH is not set: the function does not know its environment");
  await loadParameters(path);
  await import("../main");
}

start().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
