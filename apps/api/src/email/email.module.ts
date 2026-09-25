import { DynamicModule, Module } from "@nestjs/common";
import type { Config } from "../config";
import { EmailAssets } from "./assets.service";

@Module({})
export class EmailModule {
  // The origin of the site comes from the environment and is bound once, like the origins the
  // subscriber links are built from.
  static forRoot(config: Config): DynamicModule {
    return {
      module: EmailModule,
      providers: [{ provide: EmailAssets, useFactory: () => new EmailAssets(config.WEB_ORIGIN) }],
      exports: [EmailAssets],
    };
  }
}
