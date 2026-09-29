import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { Effect } from "effect";
import { assetBaseUrl, assetUrls } from "./assets";

// The HTML only carries the URL of each image: whether the bucket (or, locally, the site) actually
// serves it is another step's business, and a broken one arrives as an empty box in the inbox with nothing said
// anywhere. This is what says it. The check belongs here and not in `validate.ts`, which is
// deterministic on purpose — same input, same output, no network.

export type AssetStatus = { url: string; ok: boolean; detail: string };

const TIMEOUT_MS = 5_000;

@Injectable()
export class EmailAssets implements OnApplicationBootstrap {
  private readonly logger = new Logger(EmailAssets.name);

  constructor(private readonly origin: string) {}

  // Every deploy restarts the API, so every deploy states in the log whether the images this
  // build points at are being served. It never blocks the boot: an image out of the air is not a
  // reason to take the API down, it is a reason to be loud about it.
  async onApplicationBootstrap(): Promise<void> {
    await Effect.runPromise(this.report());
  }

  // Logs one line either way, with the exact URLs. The caller gets the statuses; the future
  // sending step is the other place that wants them, right before an edition goes out.
  report(): Effect.Effect<AssetStatus[]> {
    return this.check().pipe(
      Effect.tap((statuses) =>
        Effect.sync(() => {
          const base = assetBaseUrl(this.origin);
          const broken = statuses.filter((status) => !status.ok);
          if (broken.length === 0) return this.logger.log({ msg: "email assets ok", base, count: statuses.length });
          this.logger.error({ msg: "email assets unreachable", base, broken });
        }),
      ),
    );
  }

  check(): Effect.Effect<AssetStatus[]> {
    return Effect.forEach(assetUrls(this.origin), (url) => this.head(url), { concurrency: 4 });
  }

  // A HEAD that answers with something other than an image is as broken as one that does not
  // answer: a Next.js 404 is a 404 page, served with status 404 and text/html.
  private head(url: string): Effect.Effect<AssetStatus> {
    return Effect.tryPromise({
      try: () => fetch(url, { method: "HEAD", signal: AbortSignal.timeout(TIMEOUT_MS) }),
      // The reason is the whole point of the log: a timeout and a refused connection are
      // different failures, and `UnknownException` would report both as neither.
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    }).pipe(
      Effect.map((response) => {
        const type = response.headers.get("content-type") ?? "";
        return {
          url,
          ok: response.ok && type.startsWith("image/"),
          detail: `${response.status} ${type || "sem content-type"}`,
        };
      }),
      Effect.catchAll((error) => Effect.succeed({ url, ok: false, detail: `${error.name}: ${error.message}` })),
    );
  }
}
