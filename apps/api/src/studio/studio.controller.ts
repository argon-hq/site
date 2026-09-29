import { BeforeApplicationShutdown, Controller, Get, NotFoundException, Param, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { Public } from "../auth/public.decorator";
import { StudioService } from "./studio.service";

// Mastra Studio, served by the API itself. Only the bundle is public: it carries no data, and every
// call it makes lands on /mastra, where the internal secret is still required — the operator saves
// it once in the Studio (Settings → instance URL, API prefix and headers) and the browser sends it
// from there on. Registered only where STUDIO_ENABLED says so, so production serves nothing.
@Public()
@Controller("studio")
export class StudioController implements BeforeApplicationShutdown {
  constructor(private readonly studio: StudioService) {}

  // Streams open right now, so shutdown can end them. See beforeApplicationShutdown.
  private readonly streams = new Set<Response>();

  // The bundle's inline script opens this stream to learn about a restart of the `mastra dev`
  // server. There is nothing to reload here, but an open stream keeps the browser from reconnecting
  // in a loop for the life of the page.
  @Get("refresh-events")
  events(@Req() request: Request, @Res() response: Response) {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
    });
    response.write(": open\n\n");
    this.streams.add(response);
    request.on("close", () => this.streams.delete(response));
  }

  // A stream that never ends is a socket that never closes, and the HTTP server does not finish
  // closing while one is open: without this, SIGTERM waits for every Studio tab anyone left open,
  // and the deploy kills the container on the grace period instead of stopping it. It has to be
  // this hook and not onApplicationShutdown, which Nest runs only after the server is closed —
  // that is, after the very wait this exists to avoid.
  beforeApplicationShutdown() {
    for (const stream of this.streams) stream.end();
    this.streams.clear();
  }

  @Get()
  index(@Req() request: Request, @Res() response: Response) {
    this.sendIndex(request, response);
  }

  // Everything else under /studio: a file of the bundle when it is one, and the same index.html
  // otherwise — the Studio routes /studio/agents and the rest on the client.
  @Get("*path")
  asset(@Param("path") path: string | string[], @Req() request: Request, @Res() response: Response) {
    const file = this.studio.assetPath(Array.isArray(path) ? path.join("/") : path);
    if (!file) return this.sendIndex(request, response);
    // Every file of the bundle carries a content hash in its name, so it can be cached forever.
    // `dotfiles` because on a development machine the bundle is read from under node_modules/.pnpm,
    // and the default would refuse the whole path for that dot.
    response.sendFile(file, { immutable: true, maxAge: "1y", dotfiles: "allow" });
  }

  private sendIndex(request: Request, response: Response) {
    const html = this.studio.indexHtml(this.origin(request));
    if (!html) throw new NotFoundException();
    response.type("html").setHeader("cache-control", "no-store");
    response.send(html);
  }

  // The hop from Caddy to this container is plain http, so the browser's scheme comes in the header.
  private origin(request: Request): URL {
    const forwarded = request.headers["x-forwarded-proto"];
    const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const protocol = value?.split(",")[0]?.trim() || request.protocol;
    return new URL(`${protocol}://${request.headers.host ?? "localhost"}`);
  }
}
