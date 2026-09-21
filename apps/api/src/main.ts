// Local .env first; in AWS the variables come from the container and dotenv changes nothing.
import "dotenv/config";
import "reflect-metadata";
import { ConsoleLogger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { loadConfig } from "./config";
import { PrettyLogger } from "./logger";

async function bootstrap() {
  const config = loadConfig();
  // JSON in AWS, where CloudWatch indexes the fields; one readable line on a terminal.
  const logger = config.NODE_ENV === "production" ? new ConsoleLogger({ json: true }) : new PrettyLogger();
  const app = await NestFactory.create(AppModule, { logger });
  app.enableShutdownHooks();
  await app.listen(config.PORT, "0.0.0.0");
}

bootstrap();
