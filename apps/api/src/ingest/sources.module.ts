import { Module } from "@nestjs/common";
import { SourcesController } from "./sources.controller";
import { SourcesService } from "./sources.service";

// The sources table behind internal routes, and the allowlist loaded from it at boot.
@Module({ controllers: [SourcesController], providers: [SourcesService], exports: [SourcesService] })
export class SourcesModule {}
