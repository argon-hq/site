import { describe, expect, it, vi } from "vitest";
import { PROFILE } from "../pipeline/profile";
import type { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "./settings.service";

const identity: Array<{ key: string; value: unknown }> = [
  { key: "sender", value: { name: "Argon", postalAddress: "Rua 1, Cidade" } },
];

function service(rows: Array<{ key: string; value: unknown }>) {
  const prisma = {
    setting: {
      findMany: vi.fn(async () => rows),
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => rows.find((r) => r.key === where.key) ?? null),
      upsert: vi.fn(async () => undefined),
    },
  };
  return { prisma, settings: new SettingsService(prisma as unknown as PrismaService) };
}

describe("SettingsService", () => {
  it("loads the seeded rows and fills the defaults", async () => {
    const { settings } = service(identity);
    const s = await settings.load();
    expect(s.sending_paused).toBe(false);
    expect(s.owner_emails).toEqual([]);
    expect(s.sender.name).toBe("Argon");
    expect(s.social).toEqual({});
  });

  it("takes what shapes the edition from the environment's profile when there is no row", async () => {
    const { settings } = service(identity);
    const s = await settings.load();

    expect(s.min_articles).toBe(PROFILE.minArticles);
    expect(s.max_articles).toBe(PROFILE.maxArticles);
  });

  it("lets a row win over the profile: it is how an environment says something else", async () => {
    const { settings } = service(identity.concat({ key: "max_articles", value: 9 }));
    const s = await settings.load();

    expect(s.max_articles).toBe(9);
    expect(PROFILE.maxArticles).not.toBe(9);
  });

  it("fails naming the missing or invalid keys", async () => {
    const { settings } = service(identity.filter((r) => r.key !== "sender").concat({ key: "max_articles", value: 0 }));
    await expect(settings.load()).rejects.toThrow("Invalid settings: max_articles, sender");
  });

  it("reads one key with its default when there is no row", async () => {
    const { settings } = service(identity);
    expect(await settings.get("sending_paused")).toBe(false);
    await expect(settings.get("sender")).resolves.toMatchObject({ name: "Argon" });
  });

  it("validates before writing", async () => {
    const { prisma, settings } = service(identity);
    await expect(settings.set("owner_emails", ["not-an-email"])).rejects.toThrow("Invalid setting owner_emails");
    expect(prisma.setting.upsert).not.toHaveBeenCalled();
    await settings.set("sending_paused", true);
    expect(prisma.setting.upsert).toHaveBeenCalledWith({
      where: { key: "sending_paused" },
      create: { key: "sending_paused", value: true },
      update: { value: true },
    });
  });
});
