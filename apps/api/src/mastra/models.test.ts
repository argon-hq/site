import { RequestContext } from "@mastra/core/request-context";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MODEL, modelContext, modelId, modelOf, type ModelContext } from "./models";

afterEach(() => vi.unstubAllEnvs());

describe("the models", () => {
  it("are Haiku on both steps unless the environment says otherwise, one step at a time", () => {
    expect([modelId("select"), modelId("write")]).toEqual([DEFAULT_MODEL, DEFAULT_MODEL]);
    vi.stubEnv("MODEL_SELECT", "claude-sonnet-5");
    expect([modelId("select"), modelId("write")]).toEqual(["claude-sonnet-5", DEFAULT_MODEL]);
  });

  it("are picked per call from the step in the request context, writing when there is none", () => {
    vi.stubEnv("MODEL_SELECT", "claude-sonnet-5");
    expect(modelOf({ requestContext: modelContext("select") })).toBe("anthropic/claude-sonnet-5");
    expect(modelOf({ requestContext: modelContext("write") })).toBe(`anthropic/${DEFAULT_MODEL}`);
    expect(modelOf({ requestContext: new RequestContext<ModelContext>() })).toBe(`anthropic/${DEFAULT_MODEL}`);
  });
});
