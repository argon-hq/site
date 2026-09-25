// Reproducible preview from the fixtures, for the visual review and the manual test in mail clients.
// Usage: pnpm email:preview  →  out/email-preview.html and out/email-preview-edge.html (images
// inlined), plus the matching .txt files.

import { Effect } from "effect";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { EMAIL_ICONS } from "./assets";
import { buildEdition } from "./edition/build";
import { editionEdgeFixture } from "./fixtures/edition-edge";
import { editionFixture } from "./fixtures/edition";
import type { EditionInput } from "./types";
import { validateEdition } from "./validate";

const outDir = path.resolve("out");

// Preview only: swap image URLs for data URIs so the file opens without a server. It is also why
// the preview never catches a broken image: on disk they are always there. What catches it is
// `EmailAssets`, against the site that actually serves them.
function inlineIcons(html: string, assetBaseUrl: string) {
  return Effect.reduce(EMAIL_ICONS, html, (current, icon) =>
    Effect.promise(() => readFile(path.resolve("../web/public/email", `${icon}.png`))).pipe(
      Effect.map((png) =>
        current.replaceAll(`${assetBaseUrl}/${icon}.png`, `data:image/png;base64,${png.toString("base64")}`),
      ),
    ),
  );
}

function preview(name: string, input: EditionInput) {
  return Effect.gen(function* () {
    const built = yield* buildEdition(input);
    yield* validateEdition(input, built);
    const html = yield* inlineIcons(built.html, input.assetBaseUrl);
    yield* Effect.promise(() => writeFile(path.join(outDir, `${name}.html`), html));
    yield* Effect.promise(() => writeFile(path.join(outDir, `${name}.txt`), built.text));
    yield* Effect.log(`Preview: out/${name}.html (${Buffer.byteLength(built.html)} bytes no HTML de envio)`);
  });
}

const main = Effect.gen(function* () {
  yield* Effect.promise(() => mkdir(outDir, { recursive: true }));
  yield* preview("email-preview", editionFixture);
  yield* preview("email-preview-edge", editionEdgeFixture);
});

// A failed preview is a broken template: log the cause and leave a non-zero exit code behind.
void Effect.runPromise(
  main.pipe(
    Effect.catchAllCause((cause) =>
      Effect.logError(cause).pipe(Effect.andThen(Effect.sync(() => (process.exitCode = 1)))),
    ),
  ),
);
