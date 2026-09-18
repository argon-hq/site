// Reproducible preview from the fixtures, for the visual review and the manual test in mail clients.
// Usage: pnpm email:preview  →  out/email-preview.html and out/email-preview-edge.html (images
// inlined), plus the matching .txt files.

import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildEdition } from "./edition/build";
import { editionFixture } from "./fixtures/edition";
import { editionEdgeFixture } from "./fixtures/edition-edge";
import type { EditionInput } from "./types";
import { validateEdition } from "./validate";

const outDir = path.resolve("out");

async function preview(name: string, input: EditionInput) {
  const built = buildEdition(input);
  const errors = validateEdition(input, built);
  if (errors.length) throw new Error(`Template inválido (${name}):\n${errors.map((e) => `- ${e.code}: ${e.message}`).join("\n")}`);

  // Preview only: swap image URLs for data URIs so the file opens without a server.
  let html = built.html;
  for (const icon of ["logo", "linkedin", "instagram", "youtube"]) {
    const png = await readFile(path.resolve("public/email", `${icon}.png`));
    html = html.replaceAll(`${input.assetBaseUrl}/${icon}.png`, `data:image/png;base64,${png.toString("base64")}`);
  }
  await writeFile(path.join(outDir, `${name}.html`), html);
  await writeFile(path.join(outDir, `${name}.txt`), built.text);
  console.log(`Preview: out/${name}.html (${Buffer.byteLength(built.html)} bytes no HTML de envio)`);
}

async function main() {
  await mkdir(outDir, { recursive: true });
  await preview("email-preview", editionFixture);
  await preview("email-preview-edge", editionEdgeFixture);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
