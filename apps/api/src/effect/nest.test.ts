import { HttpException } from "@nestjs/common";
import { Data, Effect } from "effect";
import { describe, expect, it } from "vitest";
import { CONFLICT, NOT_FOUND } from "./failure";
import { runEffect } from "./nest";

class Missing extends Data.TaggedError("Missing")<{ reason: string; status?: number }> {}
class Broke extends Data.TaggedError("Broke")<{ step: string; reason: string }> {}

const thrown = async (promise: Promise<unknown>): Promise<HttpException> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) return error;
    throw error;
  }
  throw new Error("expected the route to throw");
};

describe("runEffect", () => {
  it("returns the value of a successful effect", async () => {
    expect(await runEffect("build", Effect.succeed(42))).toBe(42);
  });

  it("answers with the status the failure asks for, and its reason", async () => {
    const error = await thrown(
      runEffect(
        "send",
        Effect.fail(new Missing({ reason: "edition 2026-09-24 does not exist yet", status: NOT_FOUND })),
      ),
    );
    expect(error.getStatus()).toBe(404);
    expect(error.getResponse()).toEqual({ step: "send", reason: "edition 2026-09-24 does not exist yet" });
  });

  it("answers 500 for a typed failure with nothing to say about the status", async () => {
    const error = await thrown(runEffect("build", Effect.fail(new Missing({ reason: "database: connection lost" }))));
    expect(error.getStatus()).toBe(500);
  });

  it("names the step the failure carries instead of the route", async () => {
    const error = await thrown(runEffect("run", Effect.fail(new Broke({ step: "write", reason: "x" }))));
    expect(error.getResponse()).toEqual({ step: "write", reason: "x" });
  });

  it("keeps a defect's cause out of the response", async () => {
    const error = await thrown(runEffect("collect", Effect.die(new Error("secret internals /srv/app/x.ts:12"))));
    expect(error.getStatus()).toBe(500);
    expect(JSON.stringify(error.getResponse())).not.toContain("secret internals");
    expect(error.getResponse()).toEqual({ step: "collect", reason: "internal error" });
  });

  it("passes a conflict through as 409", async () => {
    const error = await thrown(
      runEffect("run", Effect.fail(new Missing({ reason: "a run is already in flight", status: CONFLICT }))),
    );
    expect(error.getStatus()).toBe(409);
  });
});
