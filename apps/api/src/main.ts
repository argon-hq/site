import "reflect-metadata";
import { ConsoleLogger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { loadConfig } from "./config";

async function bootstrap() {
  const config = loadConfig();
  // JSON logs: CloudWatch indexes the fields.
  const app = await NestFactory.create(AppModule, { logger: new ConsoleLogger({ json: true }) });
  app.enableShutdownHooks();
  await app.listen(config.PORT, "0.0.0.0");
}

bootstrap();
