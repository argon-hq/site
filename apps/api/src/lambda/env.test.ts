import { describe, expect, it, vi } from "vitest";
import { fillEnv, parametersUnder } from "./env";

describe("the parameters of an environment", () => {
  it("are read page by page, named by the last segment of their path", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        Parameters: [{ Name: "/argon/lab/DATABASE_URL", Value: "postgresql://x" }],
        NextToken: "next",
      })
      .mockResolvedValueOnce({ Parameters: [{ Name: "/argon/lab/MAIL_FROM", Value: "a@b.c" }] });

    await expect(parametersUnder("/argon/lab/", fetch)).resolves.toEqual({
      DATABASE_URL: "postgresql://x",
      MAIL_FROM: "a@b.c",
    });
    expect(fetch).toHaveBeenNthCalledWith(2, "/argon/lab/", "next");
  });

  it("fill only what the function did not set itself", () => {
    const env: NodeJS.ProcessEnv = { SCHEDULER_ENABLED: "false" };
    const filled = fillEnv(env, { SCHEDULER_ENABLED: "true", DATABASE_URL: "postgresql://x" });

    expect(env).toEqual({ SCHEDULER_ENABLED: "false", DATABASE_URL: "postgresql://x" });
    expect(filled).toEqual(["DATABASE_URL"]);
  });

  it("keep a value with a dollar sign as it is", () => {
    const env: NodeJS.ProcessEnv = {};
    fillEnv(env, { STUDIO_AUTH_HASH: "$2a$14$abc" });
    expect(env.STUDIO_AUTH_HASH).toBe("$2a$14$abc");
  });
});
