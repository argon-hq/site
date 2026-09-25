import { Injectable, Logger } from "@nestjs/common";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { renderStudioHtml } from "./studio.html";

// Where the static bundle is. In the image it is copied next to the code, because the `mastra` CLI
// that carries it is a devDependency and never reaches the runtime stage; on a development machine
// it is read straight out of node_modules.
function resolveBundle(): string | null {
  const candidates = [join(process.cwd(), "studio")];
  try {
    candidates.push(join(dirname(require.resolve("mastra/package.json")), "dist", "studio"));
  } catch {
    // The CLI is not installed here, which is the normal case in the image.
  }
  return candidates.find((path) => existsSync(join(path, "index.html"))) ?? null;
}

@Injectable()
export class StudioService {
  private readonly logger = new Logger(StudioService.name);
  private readonly bundle = resolveBundle();
  // One filled index.html per origin: the file is read and patched once, not on every navigation.
  private readonly html = new Map<string, string>();

  constructor() {
    if (this.bundle) this.logger.log(`Studio served from ${this.bundle}`);
    else this.logger.warn("STUDIO_ENABLED is on but the Studio bundle is not in this image");
  }

  get available(): boolean {
    return this.bundle !== null;
  }

  indexHtml(origin: URL): string | null {
    if (!this.bundle) return null;
    const cached = this.html.get(origin.origin);
    if (cached) return cached;
    const html = renderStudioHtml(readFileSync(join(this.bundle, "index.html"), "utf8"), origin);
    this.html.set(origin.origin, html);
    return html;
  }

  // Absolute path of a file of the bundle, or null when it is not there. The path is resolved
  // before it is trusted: everything below /studio reaches this, including a crafted ../../ one.
  assetPath(path: string): string | null {
    if (!this.bundle) return null;
    const absolute = resolve(this.bundle, path);
    const inside = relative(this.bundle, absolute);
    if (inside.startsWith("..")) return null;
    // A directory is not a file to send: the client routes of the Studio land here too.
    if (!existsSync(absolute) || !statSync(absolute).isFile()) return null;
    return absolute;
  }
}
