import { describe, expect, it } from "vitest";
import { dedupeByUrl, groupSameFact, rank, type Candidate } from "./group";
import { titleSignature } from "./signature";
import { CUTOFF, MAX_FICHAS } from "./triage";

let n = 0;
const candidate = (over: Partial<Candidate> & { title: string }): Candidate => ({
  signals: [{ signal: "lexicon_core", points: over.score ?? 4 }],
  url: `https://x.test/${n++}`,
  sourceId: "s1",
  sourceName: "Fonte 1",
  trust: 0,
  origin: "feed",
  publishedAt: new Date("2026-09-30T06:00:00Z"),
  text: null,
  textKind: "none",
  score: 4,
  signature: titleSignature(over.title),
  ...over,
});

const DEFICIT = "Governo central tem déficit primário de R$ 13,585 bilhões em agosto";

describe("dedupeByUrl", () => {
  it("keeps one item per link, the one with more text", () => {
    const sitemap = candidate({ title: "A", url: "https://x.test/a", textKind: "none" });
    const feed = candidate({ title: "A", url: "https://x.test/a", textKind: "summary", text: "lead" });
    expect(dedupeByUrl([sitemap, feed])).toEqual([feed]);
  });
});

describe("groupSameFact", () => {
  it("makes one group of the same fact in several outlets, represented by the most trusted", () => {
    const groups = groupSameFact([
      candidate({ title: DEFICIT, sourceId: "a", sourceName: "A", trust: 0, score: 5 }),
      candidate({ title: `${DEFICIT}, diz Tesouro`, sourceId: "b", sourceName: "B", trust: 1, score: 3 }),
      candidate({ title: DEFICIT, sourceId: "c", sourceName: "C", trust: 0, score: 4 }),
      candidate({ title: "Shein decepciona no primeiro resultado", sourceId: "a" }),
    ]);
    expect(groups).toHaveLength(2);
    const deficit = groups.find((g) => g.sources === 3);
    expect(deficit?.representative.sourceName).toBe("B");
    // The best title scores the group, and each extra outlet adds a point.
    expect(deficit?.score).toBe(5 + 2);
    expect(deficit?.members.map((m) => m.sourceName)).toEqual(["A", "C"]);
    expect(deficit?.signals.at(-1)).toEqual({ signal: "cross_coverage", points: 2 });
  });

  it("caps the cross coverage at three points", () => {
    const groups = groupSameFact(
      ["a", "b", "c", "d", "e", "f"].map((id) => candidate({ title: DEFICIT, sourceId: id, score: 1 })),
    );
    expect(groups[0]?.score).toBe(1 + 3);
  });

  it("does not count two links of one outlet as cross coverage", () => {
    const groups = groupSameFact([candidate({ title: DEFICIT }), candidate({ title: DEFICIT })]);
    expect(groups[0]?.sources).toBe(1);
    expect(groups[0]?.score).toBe(4);
  });
});

describe("rank", () => {
  it("drops a fact already published, cuts below the cutoff and orders the rest by score, then recency", () => {
    const groups = groupSameFact([
      candidate({ title: DEFICIT, score: 6 }),
      candidate({ title: "Copom mantém a Selic", score: 5, publishedAt: new Date("2026-09-30T01:00:00Z") }),
      candidate({ title: "Startup recebe aporte", score: 5, publishedAt: new Date("2026-09-30T05:00:00Z") }),
      candidate({ title: "Feira reúne expositores", score: CUTOFF - 1 }),
    ]);
    const ranked = rank(groups, [{ url: "https://old.test/deficit", signature: titleSignature(DEFICIT) }]);
    expect(ranked.republished.map((r) => r.match)).toEqual(["https://old.test/deficit"]);
    expect(ranked.kept.map((g) => g.representative.title)).toEqual(["Startup recebe aporte", "Copom mantém a Selic"]);
    expect(ranked.belowCutoff.map((g) => g.representative.title)).toEqual(["Feira reúne expositores"]);
  });

  it("keeps at most MAX_FICHAS, best first, and says how many went over", () => {
    const groups = Array.from({ length: MAX_FICHAS + 5 }, (_, i) =>
      groupSameFact([candidate({ title: `Notícia única número ${i} sobre tema ${i * 7}`, score: 3 + (i % 4) })]),
    ).flat();
    const ranked = rank(groups, []);
    expect(ranked.kept).toHaveLength(MAX_FICHAS);
    expect(ranked.overCap).toHaveLength(5);
    expect(ranked.kept[0]?.score).toBe(6);
  });
});
