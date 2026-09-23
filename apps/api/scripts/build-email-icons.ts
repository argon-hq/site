// Generates the PNGs of the social icons from Font Awesome Free (brands).
// Usage: pnpm email:icons  →  apps/web/public/email/{linkedin,instagram,youtube}.png
//
// They live in the site, not here: the site is what serves static files, and the URL the template
// carries is WEB_ORIGIN + /email. The API has no static route and is on another host.
// Icons: Font Awesome Free 7, CC BY 4.0 (https://fontawesome.com/license/free). The Argon
// logo is exported from Figma and does not go through here.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { faInstagram, faLinkedinIn, faYoutube, type IconDefinition } from "@fortawesome/free-brands-svg-icons";
import sharp from "sharp";

const OUT_DIR = path.resolve("../web/public/email");
const SIZE = 40; // 2x for the 20px slot in the template
const COLOR = "#ffffff";

const icons: Record<string, IconDefinition> = {
  linkedin: faLinkedinIn,
  instagram: faInstagram,
  youtube: faYoutube,
};

function toSvg({ icon: [width, height, , , pathData] }: IconDefinition): string {
  // Centers the glyph in a square box so every icon has the same visual size.
  const side = Math.max(width, height);
  const x = (side - width) / 2;
  const y = (side - height) / 2;
  const d = Array.isArray(pathData) ? pathData.join(" ") : pathData;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-x} ${-y} ${side} ${side}"><path fill="${COLOR}" d="${d}"/></svg>`;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  for (const [name, icon] of Object.entries(icons)) {
    const png = await sharp(Buffer.from(toSvg(icon))).resize(SIZE, SIZE).png().toBuffer();
    await writeFile(path.join(OUT_DIR, `${name}.png`), png);
    console.log(`${name}.png (${png.length} bytes)`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
