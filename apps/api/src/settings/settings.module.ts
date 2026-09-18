import { Global, Module } from "@nestjs/common";
import { SettingsService } from "./settings.service";

// Global: any module injects SettingsService without importing this one.
@Global()
@Module({ providers: [SettingsService], exports: [SettingsService] })
export class SettingsModule {}
