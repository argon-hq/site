import { describe, expect, it } from "vitest";
import { SIGNATURE_SIZE, similarity, titleSignature, titleTokens } from "./signature";
import { SAME_FACT } from "./triage";

const sim = (a: string, b: string) => similarity(titleSignature(a), titleSignature(b));

describe("the title signature", () => {
  it("normalizes case, accents, stopwords and plurals", () => {
    expect(titleTokens("Os Juros das Empresas sobem 12%")).toEqual(["juro", "empresa", "sobem", "12%"]);
  });

  it("is stable: the same title always gives the same 64 slots", () => {
    const signature = titleSignature("Copom mantém a Selic");
    expect(signature).toHaveLength(SIGNATURE_SIZE);
    expect(titleSignature("Copom mantém a Selic")).toEqual(signature);
    expect(signature.every((v) => Number.isInteger(v) && v >= -(2 ** 31) && v < 2 ** 31)).toBe(true);
  });

  it("finds the same fact told by two outlets", () => {
    expect(
      sim(
        "Governo central tem déficit primário de R$ 13,585 bilhões em agosto",
        "Governo Central Tem Déficit Primário de R$13,585 Bilhões em Agosto, Diz Tesouro",
      ),
    ).toBeGreaterThanOrEqual(SAME_FACT);
    expect(
      sim(
        "Transações com Pix têm queda de 10% após proibição de bets",
        "Transações Via Pix Caem 10% após Proibição das Bets",
      ),
    ).toBeGreaterThanOrEqual(SAME_FACT);
  });

  it("keeps different facts apart", () => {
    expect(sim("Copom mantém a Selic", "Shein decepciona em seu primeiro resultado")).toBeLessThan(SAME_FACT);
  });

  it("does not catch a title rewritten with other words — what escapes without an embedding", () => {
    expect(
      sim(
        "Governo amplia limite do MEI para R$ 150 mil a partir de janeiro",
        "Teto do microempreendedor individual passa a R$ 150 mil no ano que vem",
      ),
    ).toBeLessThan(SAME_FACT);
  });

  it("has no signature for an empty title", () => {
    expect(titleSignature("a de o")).toEqual([]);
    expect(similarity([], titleSignature("Copom"))).toBe(0);
  });
});
