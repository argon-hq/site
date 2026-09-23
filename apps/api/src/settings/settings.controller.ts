import { Body, Controller, Get, Patch } from "@nestjs/common";
import { z } from "zod";
import { ZodBody } from "../validation/zod-body.pipe";
import { settingKeys, settingsSchema, type SettingKey, type Settings } from "./settings.schema";
import { SettingsService } from "./settings.service";

// The key first, so the value is validated by the schema of that key and not by a union of all of
// them: a bad number for `score_cutoff` is refused for being a bad cutoff.
export const patchBody = z
  .object({ key: z.enum(settingKeys as [SettingKey, ...SettingKey[]]), value: z.unknown() })
  .superRefine((body, ctx) => {
    const result = settingsSchema.shape[body.key].safeParse(body.value);
    if (!result.success) for (const issue of result.error.issues) ctx.addIssue({ ...issue, path: ["value", ...issue.path] });
  });

@Controller("settings")
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  // GET /settings → the table as the pipeline reads it, defaults included. With the edition
  // settings defaulting from the environment's profile, this is how one sees what is actually in
  // force here. Internal secret required.
  @Get()
  read(): Promise<Settings> {
    return this.settings.load();
  }

  // PATCH /settings { key, value } → one setting, for this environment. A row is how an environment
  // says something other than what the profile assumed; without one, the default in code holds.
  // Internal secret required.
  @Patch()
  async write(@Body(ZodBody(patchBody)) body: z.infer<typeof patchBody>) {
    await this.settings.set(body.key, body.value as Settings[SettingKey]);
    return { key: body.key, value: await this.settings.get(body.key) };
  }
}
