import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { FetchDeps } from "../net/fetch";
import { fetchFeed } from "./fetch-feed";

const RSS = `<?xml version="1.0" encoding="ISO-8859-1"?><rss version="2.0"><channel>
<item><title>Negócio fechado</title><link>https://fonte.test/a</link><pubDate>Tue, 29 Sep 2026 10:00:00 -0300</pubDate></item>
</channel></rss>`;

type Answer = { status: number; body: string; type?: string };

// A fake network that answers in order, one answer per call, and remembers how often it was asked.
function network(...answers: Answer[]) {
  const calls: string[] = [];
  const deps: FetchDeps = {
    resolve: async () => [{ address: "200.1.2.3", family: 4 }],
    fetch: async (url) => {
      calls.push(url);
      const answer = answers.shift();
      if (!answer) throw new Error("no answer left");
      return new Response(Buffer.from(answer.body, "latin1"), {
        status: answer.status,
        headers: { "content-type": answer.type ?? "application/rss+xml" },
      });
    },
  };
  return { deps, calls };
}

const read = (deps: FetchDeps) =>
  Effect.runPromise(Effect.either(fetchFeed("https://fonte.test/feed", () => true, deps)));

describe("fetchFeed", () => {
  it("reads the feed in the charset of its prolog and reports the address, status and size", async () => {
    const { deps } = network({ status: 200, body: RSS });
    const result = await read(deps);
    expect(result).toMatchObject({
      _tag: "Right",
      right: { url: "https://fonte.test/feed", status: 200, charset: "iso-8859-1", format: "rss" },
    });
    expect(result._tag === "Right" && result.right.items[0]?.title).toBe("Negócio fechado");
  });

  it("retries once on a server error, and gives up with the status when it repeats", async () => {
    const recovered = network({ status: 503, body: "" }, { status: 200, body: RSS });
    expect((await read(recovered.deps))._tag).toBe("Right");
    expect(recovered.calls).toHaveLength(2);

    const down = network({ status: 503, body: "" }, { status: 503, body: "" });
    expect(await read(down.deps)).toMatchObject({ _tag: "Left", left: { _tag: "FetchFailed", status: 503 } });
    expect(down.calls).toHaveLength(2);
  }, 10_000);

  it("does not retry a refusal or a malformed feed: they would answer the same", async () => {
    const gone = network({ status: 404, body: "" });
    expect(await read(gone.deps)).toMatchObject({ _tag: "Left", left: { _tag: "FetchFailed", status: 404 } });
    expect(gone.calls).toHaveLength(1);

    const html = network({ status: 200, body: "<html><body>Not a feed</body></html>", type: "text/html" });
    const result = await read(html.deps);
    expect(result).toMatchObject({ _tag: "Left", left: { _tag: "FeedMalformed" } });
    expect(result._tag === "Left" && result.left.reason).toMatch(/not a feed/);
    expect(html.calls).toHaveLength(1);
  });
});
