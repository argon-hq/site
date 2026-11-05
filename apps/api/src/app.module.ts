import { Module } from "@nestjs/common";
import { APP_GUARD, Reflector } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { MastraModule } from "@mastra/nestjs";
import { InternalSecretGuard } from "./auth/internal-secret.guard";
import { loadConfig } from "./config";
import { EmailModule } from "./email/email.module";
import { MailModule } from "./mail/mail.module";
import { HealthController } from "./health/health.controller";
import { SourcesModule } from "./ingest/sources.module";
import { mastra } from "./mastra";
import { MastraInstanceModule } from "./mastra/mastra.module";
import { PipelineModule } from "./pipeline/pipeline.module";
import { PrismaModule } from "./prisma/prisma.module";
import { SettingsModule } from "./settings/settings.module";
import { StudioModule } from "./studio/studio.module";
import { SubscriberModule } from "./subscriber/subscriber.module";

const config = loadConfig();

@Module({
  imports: [
    // The clock only exists where SCHEDULER_ENABLED is on. Without the module, the @Cron methods are
    // plain methods: the Lambda calls them by name through the jobs route instead.
    ...(config.SCHEDULER_ENABLED ? [ScheduleModule.forRoot()] : []),
    PrismaModule.forRoot(config.DATABASE_URL),
    MastraInstanceModule,
    SettingsModule,
    EmailModule.forRoot(config),
    MailModule.forRoot(config),
    SourcesModule,
    PipelineModule.forRoot(config),
    SubscriberModule.forRoot(config),
    StudioModule.forRoot(config),
    // The Mastra routes under /mastra are the Studio's and nobody else's, so they exist only where the
    // Studio is served — a development machine. Every deployed function runs without them: no route
    // to an agent or a workflow, and no /mastra catch-all, on a Lambda. The pipeline reaches the
    // instance through MastraInstanceModule either way. Last on purpose: it registers a catch-all.
    ...(config.STUDIO_ENABLED ? [MastraModule.register({ mastra, prefix: "/mastra" })] : []),
  ],
  controllers: [HealthController],
  providers: [
    { provide: "CONFIG", useValue: config },
    {
      provide: APP_GUARD,
      useFactory: (reflector: Reflector) =>
        new InternalSecretGuard(reflector, config.INTERNAL_API_SECRET, config.STUDIO_ENABLED),
      inject: [Reflector],
    },
  ],
})
export class AppModule {}
