import { describe, expect, it } from "vitest";
import { itemPrompt, type Candidate } from "../pipeline/write";
import { articleFromPrompt, writeFidelity } from "./studio-extras";
import { WRITE_FIDELITY_SCORER } from "./scorer-ids";

describe("the fidelity scorer", () => {
  it("is registered under the id the dataset names", () => {
    expect(writeFidelity.id).toBe(WRITE_FIDELITY_SCORER);
  });

  it("checks the answer against the article the writing prompt carries", () => {
    const prompt = itemPrompt({
      originalTitle: "Selic",
      extractedText: "O Copom manteve a Selic em 10,5%.",
      textFrom: { url: "https://valor.globo.com/x", sourceName: "Valor", via: "feed" },
    } as Candidate);

    expect(articleFromPrompt(prompt)).toBe("O Copom manteve a Selic em 10,5%.");
    expect(articleFromPrompt(undefined)).toBe("");
  });
});
