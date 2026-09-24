import { describe, expect, it } from "vitest";
import { itemPrompt } from "../pipeline/write";
import { PROFILE } from "../pipeline/profile";
import { articleFromPrompt, collectRigor } from "./scorers";

// One assistant message whose parts are the tool calls the agent made, as Mastra stores them.
const outputWith = (tools: string[]) => [
  {
    id: "m1",
    role: "assistant",
    createdAt: new Date(),
    content: {
      format: 2,
      parts: tools.map((toolName, index) => ({
        type: "tool-invocation",
        toolInvocation: { toolName, toolCallId: `c${index}`, args: {}, state: "result", result: {} },
      })),
    },
  },
];

const run = (tools: string[]) =>
  collectRigor.run({
    input: { inputMessages: [], rememberedMessages: [], systemMessages: [], taggedSystemMessages: {} },
    output: outputWith(tools),
  } as never);

describe("collect rigor", () => {
  it("is full when the run read at least the profile's floor", async () => {
    const reads = Array.from({ length: PROFILE.minReads }, () => "read_page");

    const result = await run([...reads, "web_search", "web_search"]);

    expect(result.score).toBe(1);
    expect(result.reason).toBe(`${PROFILE.minReads} page(s) read (floor ${PROFILE.minReads}), 2 search(es).`);
  });

  it("falls with every page the run judged without opening", async () => {
    const result = await run(["web_search", "read_page"]);

    expect(result.score).toBeCloseTo(1 / PROFILE.minReads);
  });
});

describe("the article a writing prompt carries", () => {
  it("is what the fidelity judge checks the answer against", () => {
    const prompt = itemPrompt({
      id: "a1",
      canonicalUrl: "https://valor.globo.com/x",
      sourceName: "Valor",
      originalTitle: "Selic",
      extractedText: "O Copom manteve a Selic em 10,5%.",
    });

    expect(articleFromPrompt(prompt)).toBe("O Copom manteve a Selic em 10,5%.");
    expect(articleFromPrompt(undefined)).toBe("");
  });
});
