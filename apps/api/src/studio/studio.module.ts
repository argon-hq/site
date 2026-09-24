import { DynamicModule, Module } from "@nestjs/common";
import type { Config } from "../config";
import { StudioController } from "./studio.controller";
import { StudioService } from "./studio.service";

@Module({})
export class StudioModule {
  // The flag decides whether the routes exist at all: where it is off, nothing of the Studio is
  // served and /studio falls through to the Mastra catch-all, which answers 401 like any other
  // unknown path. Import this before MastraModule, or the catch-all answers first.
  static forRoot(config: Config): DynamicModule {
    return {
      module: StudioModule,
      controllers: config.STUDIO_ENABLED ? [StudioController] : [],
      providers: config.STUDIO_ENABLED ? [StudioService] : [],
    };
  }
}
