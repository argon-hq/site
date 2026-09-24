import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../prisma/prisma.service";
import type { OwnerAlert } from "./owner-alert";
import { EditionWatch, STUCK_AFTER_HOURS } from "./watch";

const now = new Date("2026-09-24T11:00:00Z");

function watch(rows: { id: string; date: Date; status: string; updatedAt: Date }[]) {
  const findMany = vi.fn(async () => rows);
  const send = vi.fn(() => Effect.void);
  const service = new EditionWatch(
    { edition: { findMany } } as unknown as PrismaService,
    { send } as unknown as OwnerAlert,
  );
  return { service, findMany, send };
}

describe("EditionWatch", () => {
  it("asks for editions left generating or sending longer than the threshold", async () => {
    const { service, findMany, send } = watch([]);

    expect(await Effect.runPromise(service.check(now))).toEqual([]);

    const where = findMany.mock.calls[0]?.[0 as never] as { where: { status: { in: string[] }; updatedAt: { lt: Date } } } | undefined;
    expect(where?.where.status.in).toEqual(["generating", "sending"]);
    expect(where?.where.updatedAt.lt.toISOString()).toBe(new Date(now.getTime() - STUCK_AFTER_HOURS * 3_600_000).toISOString());
    expect(send).not.toHaveBeenCalled();
  });

  it("names every stuck edition once to the owners, with how to resume", async () => {
    const { service, send } = watch([
      { id: "e1", date: new Date("2026-09-23T00:00:00Z"), status: "sending", updatedAt: new Date("2026-09-23T10:05:00Z") },
    ]);

    const stuck = await Effect.runPromise(service.check(now));

    expect(stuck).toEqual([{ id: "e1", date: "2026-09-23", status: "sending", updatedAt: "2026-09-23T10:05:00.000Z" }]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0 as never]).toBe("watch");
    expect(String(send.mock.calls[0]?.[1 as never])).toContain("2026-09-23 is sending");
    expect(String(send.mock.calls[0]?.[1 as never])).toContain("/pipeline/send");
  });
});
