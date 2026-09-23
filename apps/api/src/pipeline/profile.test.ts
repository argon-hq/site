import { describe, expect, it } from "vitest";
import { deploymentSchema, PROFILES, resolveMode, type Deployment } from "./profile";

const cheaperThan = (a: Deployment, b: Deployment) => {
  const cheap = PROFILES[a];
  const rich = PROFILES[b];
  expect(cheap.maxSearches).toBeLessThan(rich.maxSearches);
  expect(cheap.maxSteps).toBeLessThan(rich.maxSteps);
  expect(cheap.maxTextChars).toBeLessThan(rich.maxTextChars);
  expect(cheap.maxArticles).toBeLessThanOrEqual(rich.maxArticles);
};

describe("the environment profiles", () => {
  it("only knows the four environments there are", () => {
    expect(deploymentSchema.safeParse("staging").success).toBe(false);
    expect(Object.keys(PROFILES).sort()).toEqual(["dev", "lab", "local", "prod"]);
  });

  it("runs the agent in production, over the fixture in lab and on a development machine", () => {
    expect(PROFILES.prod.mode).toBe("live");
    expect(PROFILES.dev.mode).toBe("live");
    expect(PROFILES.lab.mode).toBe("mock");
    expect(PROFILES.local.mode).toBe("mock");
  });

  it("pays for the best model only where the edition is read", () => {
    expect(PROFILES.prod.model).toBe("claude-sonnet-5");
    for (const env of ["dev", "lab", "local"] as const) expect(PROFILES[env].model).not.toBe(PROFILES.prod.model);
  });

  it("spends less the further it gets from production", () => {
    cheaperThan("dev", "prod");
    cheaperThan("lab", "dev");
    expect(PROFILES.local).toEqual(PROFILES.lab);
  });

  it("accepts a weaker edition outside production, so a run there still closes", () => {
    for (const env of ["dev", "lab", "local"] as const) {
      expect(PROFILES[env].scoreCutoff).toBeLessThan(PROFILES.prod.scoreCutoff);
      expect(PROFILES[env].minArticles).toBeLessThan(PROFILES.prod.minArticles);
    }
  });
});

describe("resolveMode", () => {
  it("does what the environment says when nobody asks", () => {
    expect(resolveMode("lab")).toBe("mock");
    expect(resolveMode("dev")).toBe("live");
  });

  it("lets lab and local pay for a real run when asked", () => {
    expect(resolveMode("lab", "live")).toBe("live");
    expect(resolveMode("local", "live")).toBe("live");
  });

  it("never runs production over a fixture, whoever asks", () => {
    expect(resolveMode("prod")).toBe("live");
    expect(resolveMode("prod", "mock")).toBe("live");
  });
});
