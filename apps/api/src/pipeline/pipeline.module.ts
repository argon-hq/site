import { DynamicModule, Module } from "@nestjs/common";
import type { Config } from "../config";
import { ORIGINS } from "../subscriber/urls";
import { OwnerAlert } from "./owner-alert";
import { PipelineController } from "./pipeline.controller";
import { PipelineService } from "./pipeline.service";

@Module({})
export class PipelineModule {
  // The building step puts the unsubscribe link in the stored HTML, so it needs the same origins
  // the subscriber module binds: they come from the environment, once, instead of being read
  // wherever a URL is built.
  static forRoot(config: Config): DynamicModule {
    return {
      module: PipelineModule,
      controllers: [PipelineController],
      providers: [
        { provide: ORIGINS, useValue: { web: config.WEB_ORIGIN, api: config.API_ORIGIN } },
        PipelineService,
        OwnerAlert,
      ],
    };
  }
}
