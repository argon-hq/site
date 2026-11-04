import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../prisma/prisma.service";
import { HealthController } from "./health.controller";

describe("the health routes", () => {
  it("answer /health/live without touching the database", () => {
    const query = vi.fn();
    const health = new HealthController({ $queryRaw: query } as unknown as PrismaService);
    expect(health.live()).toEqual({ ok: true });
    expect(query).not.toHaveBeenCalled();
  });

  it("answer /health only after the database does", async () => {
    const query = vi.fn().mockResolvedValue([{ "?column?": 1 }]);
    const health = new HealthController({ $queryRaw: query } as unknown as PrismaService);
    await expect(health.get()).resolves.toEqual({ ok: true, database: true });
    expect(query).toHaveBeenCalledOnce();
  });
});
