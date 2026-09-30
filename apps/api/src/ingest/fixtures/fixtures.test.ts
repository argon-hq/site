import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { fetchArticle } from "../../mastra/tools/read-page";
import { canonicalize } from "../url";
import { fixtureAllowed, fixtureDeps, fixtureSources, STORIES, storyUrl } from ".";

const now = new Date("2026-09-30T08:30:00Z");
const read = (key: string) => {
  const story = STORIES.find((s) => s.key === key)!;
  return Effect.runPromise(
    Effect.either(fetchArticle(canonicalize(storyUrl(story, now)), fixtureDeps(now), fixtureAllowed)),
  );
};

describe("the fixture", () => {
  it("is invented: every source on a .test domain, and every text says so", () => {
    expect(fixtureSources().every((s) => s.domain.endsWith(".test"))).toBe(true);
    for (const story of STORIES) if (story.text) expect(story.text).toContain("fictícios");
  });

  it("serves a page at the canonical link a ficha stores", async () => {
    const page = await read("resultado");
    expect(page._tag).toBe("Right");
    expect(page._tag === "Right" && page.right.extractedText).toContain("Mercadão Sul");
  });

  it("answers a closed page and a page without text, for the fallbacks", async () => {
    const closed = await read("aporte");
    expect(closed._tag === "Left" && closed.left.reason).toBe("HTTP 403");
    const empty = await read("tributaria");
    expect(empty._tag === "Left" && empty.left._tag).toBe("PageUnreadable");
  });

  it("refuses anything outside its own domains", () => {
    expect(fixtureAllowed("https://www.diario-ficticio.test/x")).toBe(true);
    expect(fixtureAllowed("https://valor.globo.com/x")).toBe(false);
  });
});
