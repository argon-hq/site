import { describe, expect, it } from "vitest";
import { scoreItem, type Scored } from "./score";
import type { SectionRule } from "./source";

const rules: SectionRule[] = [
  { match: "path", pattern: "/live/", tier: "discard" },
  { match: "path", pattern: "/empresas/coluna/", tier: "discard" },
  { match: "path", pattern: "/empresas/", tier: "core" },
  { match: "path", pattern: "/tecnologia/", tier: "core" },
  { match: "path", pattern: "/economia/", tier: "market" },
  { match: "path", pattern: "/carreira/", tier: "adjacent" },
  { match: "path", pattern: "/mundo/", tier: "peripheral" },
  { match: "category", pattern: "Esporte", tier: "discard" },
  { match: "host", pattern: "aovivo.", tier: "discard" },
];

const score = (title: string, path: string, extra: { categories?: string[] } = {}): Scored =>
  scoreItem({ title, url: new URL(`https://x.test${path}`), categories: extra.categories ?? [], sectionRules: rules });

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

  it("drops personal finance as noise: what an investor does is not what a business decides", () => {
    expect(score("Juro despenca, e investidor que aplicou em IPCA+ já lucra", "/economia/a")).toMatchObject({
      outcome: "discarded",
      reason: "noise personal_finance",
    });
    expect(score("Tesouro Direto sai do ar", "/economia/a")).toMatchObject({ reason: "noise personal_finance" });
    expect(score("Onde investir com a Selic em 15%", "/economia/a")).toMatchObject({
      reason: "noise personal_finance",
    });
  });

  it("keeps a story of election week that is not a poll, with the election's discount", () => {
    const s = score(
      "Governo anuncia nova renegociação de dívidas para MEIs a cinco dias do primeiro turno",
      "/empresas/a",
    );
    expect(s.outcome).toBe("scored");
    expect(signals(s)).toMatchObject({ lexicon_business: 3, election: -1 });
    // Rates alone, even on election day, name no business: nothing but the discount.
    expect(signals(score("Juros despencam após 1º turno da eleição", "/a"))).toEqual({ election: -1 });
  });

  it("adds the section, the lexicon and hard data, with a reason per point, and nothing for the source", () => {
    const s = score("Crédito para pequenas empresas cresce 12% e lucro dos bancos sobe", "/empresas/a");
    expect(s.outcome).toBe("scored");
    expect(signals(s)).toEqual({ section_core: 2, lexicon_business: 3, lexicon_company: 2, hard_data: 1 });
    expect(s.outcome === "scored" && s.score).toBe(8);
  });

  it("counts technology applied to business as core, like business itself", () => {
    const s = score("Plataforma de IA automatiza cobrança de pequenas empresas", "/tecnologia/a");
    expect(signals(s)).toEqual({ section_core: 2, lexicon_technology: 3, lexicon_business: 3 });
  });

  it("gives the market nothing on its own, and three points when the title names the business effect", () => {
    expect(signals(score("Copom mantém a Selic em 15%", "/economia/a"))).toEqual({ hard_data: 1 });
    expect(signals(score("Copom mantém a Selic e crédito segue caro para empresas", "/economia/a"))).toEqual({
      market_effect: 3,
      lexicon_business: 3,
    });
    expect(signals(score("Dólar sobe e importadores repassam o custo", "/economia/a")).market_effect).toBe(3);
    expect(signals(score("Inflação de serviços pressiona reajuste de contratos", "/economia/a")).market_effect).toBe(3);
  });

  it("reads 'resultado' as the company's only when the title says which", () => {
    expect(signals(score("Petrobras divulga resultado trimestral", "/a")).lexicon_company).toBe(2);
    expect(signals(score("Mercado reage ao resultado do 1º turno", "/a")).lexicon_company).toBeUndefined();
  });

  it("counts a lexicon once, however many of its words appear", () => {
    expect(signals(score("Impostos, MEI e crédito", "/a")).lexicon_business).toBe(3);
  });

  it("takes points for routine market closes, questions, the off lexicon and abroad without Brazil", () => {
    expect(signals(score("Ibovespa fecha em alta com bancos", "/a")).market_routine).toBe(-2);
    expect(signals(score("Bolsas de NY têm direções opostas com petróleo em baixa", "/a")).market_routine).toBe(-2);
    expect(signals(score("Juros futuros despencam após o pregão", "/a")).market_routine).toBe(-2);
    expect(signals(score("Bolsa bate recorde aos 206 mil pontos", "/a")).market_routine).toBe(-2);
    expect(signals(score("Dólar tem maior queda diária em 8 anos", "/a")).market_routine).toBe(-2);
    expect(signals(score("Copasa elege Augusto Dantas Borges como diretor-presidente", "/a")).market_routine).toBe(-2);
    expect(signals(score("Vale a pena abrir uma PME?", "/a")).question).toBe(-1);
    expect(signals(score("Novela bate recorde", "/a")).lexicon_off).toBe(-3);
    expect(signals(score("Banco central da Austrália eleva impostos", "/mundo/a"))).toMatchObject({
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
