import { Effect, Exit } from "effect";
import { describe, expect, it, vi } from "vitest";
import { EditionLock, lockKey, type LockClient } from "./lock";

// A connection that answers the lock query the way it is told to, and records what it was asked.
function client(locked: boolean) {
  const calls: string[] = [];
  const fake: LockClient = {
    connect: vi.fn(async () => {
      calls.push("connect");
    }),
    query: vi.fn(async (text: string) => {
      calls.push(text.includes("try_advisory_lock") ? "lock" : text.includes("advisory_unlock") ? "unlock" : text);
      return { rows: [{ locked }] };
    }),
    end: vi.fn(async () => {
      calls.push("end");
    }),
  };
  return { fake, calls };
}

const day = "2026-09-24";

describe("EditionLock", () => {
  it("names the lock by the day, in one namespace", () => {
    expect(lockKey(day)).toBe("argon-edition:2026-09-24");
  });

  it("runs the body holding the lock, then unlocks and closes the connection", async () => {
    const { fake, calls } = client(true);
    const lock = new EditionLock("postgresql://x", () => fake);

    const value = await Effect.runPromise(
      lock.hold(
        day,
        "write",
        Effect.sync(() => calls.push("body") && 42),
      ),
    );

    expect(value).toBe(42);
    expect(calls).toEqual(["connect", "lock", "body", "unlock", "end"]);
    expect(vi.mocked(fake.query).mock.calls[0]?.[1]).toEqual([lockKey(day)]);
  });

  it("refuses at once when another step holds the day, without running the body", async () => {
    const { fake, calls } = client(false);
    const lock = new EditionLock("postgresql://x", () => fake);
    const body = vi.fn(() => 1);

    const exit = await Effect.runPromiseExit(lock.hold(day, "send", Effect.sync(body)));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit) && exit.cause._tag === "Fail") expect(exit.cause.error._tag).toBe("EditionBusy");
    expect(body).not.toHaveBeenCalled();
    expect(calls).toEqual(["connect", "lock", "end"]);
  });

  it("releases the lock when the body fails, and keeps the body's failure", async () => {
    const { fake, calls } = client(true);
    const lock = new EditionLock("postgresql://x", () => fake);

    const exit = await Effect.runPromiseExit(
      lock.hold(day, "build", Effect.fail({ _tag: "Broken", reason: "x" } as const)),
    );

    expect(Exit.isFailure(exit) && exit.cause._tag === "Fail" && exit.cause.error._tag).toBe("Broken");
    expect(calls).toEqual(["connect", "lock", "unlock", "end"]);
  });

  it("closes the connection when the lock query itself fails", async () => {
    const { fake, calls } = client(true);
    vi.mocked(fake.query).mockRejectedValueOnce(new Error("connection reset"));
    const lock = new EditionLock("postgresql://x", () => fake);

    const exit = await Effect.runPromiseExit(lock.hold(day, "collect", Effect.succeed(1)));

    expect(Exit.isFailure(exit) && exit.cause._tag === "Fail" && exit.cause.error._tag).toBe("LockDbFailed");
    expect(calls).toEqual(["connect", "end"]);
  });
});
