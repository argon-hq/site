import { existsSync } from "node:fs";
import path from "node:path";

// Folders of the Mastra side that are data, not code: the skills the agent loads, which live in the
// source tree and are copied next to the compiled code by the nest-cli assets.
//
// `__dirname` cannot name them — the Studio runs an ESM bundle, where it does not exist, and the API
// runs CommonJS, where `import.meta` does not — and the working directory cannot either: `nest
// start` and the image sit at `apps/api`, but `mastra dev` sits at `src/mastra/public`. So the
// folder is found by climbing from wherever the process started until a directory carries the
// Mastra tree. Where the sources are, they win: a skill edited by hand is read without a build, and
// the image, which ships no `src`, reads the compiled copy.
function mastraRoot(): string {
  let dir = process.cwd();
  for (;;) {
    for (const base of ["src", "dist"]) {
      const candidate = path.join(dir, base, "mastra");
      if (existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`no src/mastra or dist/mastra above ${process.cwd()}`);
    dir = parent;
  }
}

const root = mastraRoot();

export function mastraDir(name: string): string {
  return path.join(root, name);
}

// Where the Studio's Editor tab writes its tries: `apps/api/.mastra-editor`, ignored by git, next to
// the package in both runtimes (the Mastra tree is `apps/api/src/mastra`).
export function scratchEditorDir(): string {
  return path.join(root, "..", "..", ".mastra-editor");
}
