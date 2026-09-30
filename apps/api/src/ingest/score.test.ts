import { describe, expect, it } from "vitest";
import { scoreItem, type Scored } from "./score";
import type { SectionRule } from "./source";

const rules: SectionRule[] = [
  { match: "path", pattern: "/live/", tier: "discard" },
  { match: "path", pattern: "/empresas/coluna/", tier: "discard" },
  { match: "path", pattern: "/empresas/", tier: "core" },
  { match: "path", pattern: "/economia/", tier: "adjacent" },
  { match: "path", pattern: "/mundo/", tier: "peripheral" },
  { match: "category", pattern: "Esporte", tier: "discard" },
  { match: "host", pattern: "aovivo.", tier: "discard" },
];

const score = (title: string, path: string, extra: { trust?: number; categories?: string[] } = {}): Scored =>
  scoreItem({
    title,
    url: new URL(`https://x.test${path}`),
    categories: extra.categories ?? [],
    trust: extra.trust ?? 0,
    sectionRules: rules,
  });

const signals = (s: Scored) => Object.fromEntries(s.signals.map((x) => [x.signal, x.points]));

describe("scoreItem", () => {
  it("discards by section, and a discard rule wins over any other match", () => {
    expect(score("Lucro recorde", "/live/a")).toMatchObject({ outcome: "discarded", reason: "section path:/live/" });
    expect(score("Lucro recorde", "/empresas/coluna/a")).toMatchObject({ outcome: "discarded" });
    expect(score("Final do campeonato", "/a", { categories: ["esporte"] })).toMatchObject({ outcome: "discarded" });
    // A live blog on its own host, with a path like any section's.
    const live = scoreItem({
      title: "Dólar recua e Bolsa sobe com inflação dos EUA",
      url: new URL("https://aovivo.folha.uol.com.br/mercado/2026/09/01/6558-dolar.shtml"),
      categories: [],
      trust: 1,
      sectionRules: rules,
    });
    expect(live).toMatchObject({ outcome: "discarded", reason: "section host:aovivo." });
  });

  it("discards by title noise", () => {
    expect(score("Ao vivo: Ibovespa hoje", "/empresas/a")).toMatchObject({ reason: "noise live" });
    expect(score("Nova pesquisa Quaest para presidente", "/empresas/a")).toMatchObject({
      reason: "noise election_poll",
    });
    expect(score("Quem está na frente no segundo turno? Veja as últimas pesquisas", "/a")).toMatchObject({
      reason: "noise election_poll",
    });
    expect(score("Horóscopo do dia", "/a")).toMatchObject({ outcome: "discarded" });
  });

  it("keeps a story of election week that is not a poll", () => {
    const s = score(
      "Governo anuncia nova renegociação de dívidas para MEIs a cinco dias do primeiro turno",
      "/empresas/a",
    );
    expect(s.outcome).toBe("scored");
    expect(signals(s).lexicon_core).toBe(3);
  });

  it("adds the section, the lexicon, hard data and trust, with a reason per point", () => {
    const s = score("Crédito para pequenas empresas cresce 12% e lucro dos bancos sobe", "/empresas/a", { trust: 1 });
    expect(s.outcome).toBe("scored");
    expect(signals(s)).toEqual({ section_core: 2, lexicon_core: 3, lexicon_company: 2, hard_data: 1, trust: 1 });
    expect(s.outcome === "scored" && s.score).toBe(9);
  });

  it("counts a lexicon once, however many of its words appear", () => {
    expect(signals(score("Selic, juros e crédito", "/a")).lexicon_core).toBe(3);
  });

  it("takes points for routine market closes, questions, the off lexicon and abroad without Brazil", () => {
    expect(signals(score("Ibovespa fecha em alta com bancos", "/a")).market_routine).toBe(-2);
    expect(signals(score("Copasa elege Augusto Dantas Borges como diretor-presidente", "/a")).market_routine).toBe(-2);
    expect(signals(score("Vale a pena abrir uma PME?", "/a")).question).toBe(-1);
    expect(signals(score("Novela bate recorde", "/a")).lexicon_off).toBe(-3);
    expect(signals(score("Banco central da Austrália eleva juros", "/mundo/a"))).toMatchObject({
      section_peripheral: -2,
      abroad_without_brazil: -2,
    });
    expect(signals(score("China e Brasil fecham acordo de crédito", "/a")).abroad_without_brazil).toBeUndefined();
  });

  it("gives an unnamed section nothing", () => {
    const s = score("Feira reúne expositores", "/cidades/a");
    expect(s).toMatchObject({ outcome: "scored", score: 0, signals: [] });
  });
});
