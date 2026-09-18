import { Module } from "@nestjs/common";
import { APP_GUARD, Reflector } from "@nestjs/core";
import { MastraModule } from "@mastra/nestjs";
import { InternalSecretGuard } from "./auth/internal-secret.guard";
import { loadConfig } from "./config";
import { EditionModule } from "./edition/edition.module";
import { HealthController } from "./health/health.controller";
import { mastra } from "./mastra";
import { PrismaModule } from "./prisma/prisma.module";
import { SettingsModule } from "./settings/settings.module";
import { SubscriberModule } from "./subscriber/subscriber.module";

const config = loadConfig();

@Module({
  imports: [
    PrismaModule.forRoot(config.DATABASE_URL),
    SettingsModule,
    EditionModule,
    SubscriberModule,
    // Last on purpose: MastraModule registers a catch-all controller. Its routes live under /mastra.
    // Global so any module can inject MastraService without re-registering the instance.
    { ...MastraModule.register({ mastra, prefix: "/mastra" }), global: true },
  ],
  controllers: [HealthController],
  providers: [
    { provide: "CONFIG", useValue: config },
    {
      provide: APP_GUARD,
      useFactory: (reflector: Reflector) => new InternalSecretGuard(reflector, config.INTERNAL_API_SECRET),
      inject: [Reflector],
    },
  ],
})
export class AppModule {}
