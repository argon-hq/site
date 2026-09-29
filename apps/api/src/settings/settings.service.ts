import { Injectable } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { parseSetting, parseSettings, type SettingKey, type Settings } from "./settings.schema";

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  // Every row at once, validated into the typed object. The pipeline loads once per run and passes it on.
  async load(): Promise<Settings> {
    const rows = await this.prisma.setting.findMany();
    return parseSettings(Object.fromEntries(rows.map((row) => [row.key, row.value])));
  }

  // One key, fresh from the database. Used for the kill switch right before sending.
  async get<K extends SettingKey>(key: K): Promise<Settings[K]> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    return parseSetting(key, row?.value);
  }

  // The only write path: the value is validated against the key's schema before it is stored.
  async set<K extends SettingKey>(key: K, value: Settings[K]): Promise<void> {
    const parsed = parseSetting(key, value) as Prisma.InputJsonValue;
    await this.prisma.setting.upsert({ where: { key }, create: { key, value: parsed }, update: { value: parsed } });
  }
}
