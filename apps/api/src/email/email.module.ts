import { DynamicModule, Module } from "@nestjs/common";
import type { Config } from "../config";
import { assetsOrigin } from "./assets";
import { EmailAssets } from "./assets.service";

@Module({})
export class EmailModule {
  // The origin of the images comes from the environment and is bound once, like the origins the
  // subscriber links are built from.
  static forRoot(config: Config): DynamicModule {
    return {
      module: EmailModule,
      providers: [{ provide: EmailAssets, useFactory: () => new EmailAssets(assetsOrigin(config)) }],
      exports: [EmailAssets],
    };
  }
}
