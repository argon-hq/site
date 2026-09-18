import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";

const valid = {
  DATABASE_URL: "postgresql://u:p@h:5432/db",
  ANTHROPIC_API_KEY: "sk-ant-x",
  INTERNAL_API_SECRET: "0123456789abcdef",
};

describe("loadConfig", () => {
  it("reads the environment with the default port", () => {
    expect(loadConfig(valid).PORT).toBe(3001);
  });

  it("names the missing variables", () => {
    expect(() => loadConfig({ DATABASE_URL: valid.DATABASE_URL })).toThrow(/ANTHROPIC_API_KEY, INTERNAL_API_SECRET/);
  });
});
