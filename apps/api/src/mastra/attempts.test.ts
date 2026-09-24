import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { twoAttempts } from "./attempts";

describe("twoAttempts", () => {
  it("returns the first answer when it is accepted", async () => {
    const generate = vi.fn(() => Effect.succeed("ok"));
    expect(await Effect.runPromise(twoAttempts("pedido", generate, () => {}))).toBe("ok");
    expect(generate).toHaveBeenCalledOnce();
  });

  it("retries once with the reason the first attempt was rejected", async () => {
    const generate = vi
      .fn<(text: string) => Effect.Effect<string, { reason: string }>>()
      .mockImplementationOnce(() => Effect.fail({ reason: "body too long" }))
      .mockImplementationOnce(() => Effect.succeed("ok"));
    const onRetry = vi.fn();

    expect(await Effect.runPromise(twoAttempts("pedido", generate, onRetry))).toBe("ok");
    expect(onRetry).toHaveBeenCalledWith("body too long");
    expect(generate.mock.calls[1]?.[0]).toContain("body too long");
  });

  it("fails with the second reason when both attempts are rejected", async () => {
    const generate = vi
      .fn<(text: string) => Effect.Effect<string, { reason: string }>>()
      .mockImplementationOnce(() => Effect.fail({ reason: "first" }))
      .mockImplementationOnce(() => Effect.fail({ reason: "second" }));

    await expect(Effect.runPromise(twoAttempts("pedido", generate, () => {}))).rejects.toThrow(/second/);
    expect(generate).toHaveBeenCalledTimes(2);
  });
});
