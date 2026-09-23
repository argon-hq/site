import type { Agent } from "@mastra/core/agent";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { generateStructured, NothingToShape } from "./generate";

const schema = z.object({ items: z.array(z.string()) });

// An agent that records how it was called and answers whatever the test lined up.
const fakeAgent = (answers: Array<Record<string, unknown>>) => {
  const calls: Array<{ prompt: string; options: Record<string, unknown> }> = [];
  const generate = vi.fn(async (prompt: string, options: Record<string, unknown> = {}) => {
    calls.push({ prompt, options });
    return answers[calls.length - 1] ?? {};
  });
  return { agent: { generate } as unknown as Agent, calls };
};

const working = {
  text: "Li duas notícias: a e b.",
  usage: { inputTokens: 100, outputTokens: 10 },
  steps: [{}, {}, {}],
  toolCalls: [{ payload: { toolName: "skill" } }, { payload: { toolName: "web_search" } }],
};
const shaping = { object: { items: ["a", "b"] }, usage: { inputTokens: 40, outputTokens: 5 } };

describe("generateStructured", () => {
  it("lets the working call use its tools, with no schema to answer under", async () => {
    const { agent, calls } = fakeAgent([working, shaping]);

    await generateStructured(agent, "colete as notícias", { schema, maxSteps: 12 });

    expect(calls[0].prompt).toBe("colete as notícias");
    // The bug this file exists for: a schema here forces every turn into the shape of the final
    // answer, and the first turn — which only wants to call a tool — ends the run on an empty one.
    expect(calls[0].options.structuredOutput).toBeUndefined();
    expect(calls[0].options.maxSteps).toBe(12);
  });

  it("asks for the shape in a second call that cannot spend a tool or a step", async () => {
    const { agent, calls } = fakeAgent([working, shaping]);

    await generateStructured(agent, "colete as notícias", { schema });

    expect(calls).toHaveLength(2);
    expect(calls[1].options.structuredOutput).toEqual({ schema });
    expect(calls[1].options.toolChoice).toBe("none");
    expect(calls[1].options.maxSteps).toBe(1);
    // The shaping call reads the working call's answer, so nothing is researched twice.
    expect(calls[1].prompt).toContain(working.text);
  });

  it("returns the shaped object and charges for both halves", async () => {
    const { agent } = fakeAgent([working, shaping]);

    const result = await generateStructured(agent, "colete", { schema });

    expect(result.object).toEqual({ items: ["a", "b"] });
    expect(result.usage).toEqual({ inputTokens: 140, outputTokens: 15 });
  });

  it("reports the steps and tool calls of the half that did the work", async () => {
    const { agent } = fakeAgent([working, shaping]);

    const result = await generateStructured(agent, "colete", { schema });

    expect(result.steps).toBe(3);
    expect(result.toolCalls).toEqual(["skill", "web_search"]);
  });

  it("fails loudly when the second call answers without an object", async () => {
    const { agent } = fakeAgent([working, { usage: {} }]);

    await expect(generateStructured(agent, "colete", { schema })).rejects.toBeInstanceOf(NothingToShape);
  });
});
