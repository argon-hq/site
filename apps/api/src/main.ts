// Local .env first; in AWS the variables come from the container and dotenv changes nothing.
import "dotenv/config";
import "reflect-metadata";
import { ConsoleLogger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { loadConfig } from "./config";
import { PrettyLogger } from "./logger";
import { cloudFrontOrigin } from "./net/cloudfront";

async function bootstrap() {
  const config = loadConfig();
  // JSON in AWS, where CloudWatch indexes the fields; one readable line on a terminal.
  const logger = config.NODE_ENV === "production" ? new ConsoleLogger({ json: true }) : new PrettyLogger();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger });
  // One proxy in front, Caddy: `req.ip` is what it forwards, not its own address. The public
  // routes count their rate limit by it.
  app.set("trust proxy", 1);
  // On Lambda, CloudFront is in front instead (src/net/cloudfront.ts): only what came through it
  // passes, and the visitor's address is the one CloudFront wrote.
  if (config.ORIGIN_VERIFY_SECRET) app.use(cloudFrontOrigin(config.ORIGIN_VERIFY_SECRET));
  app.enableShutdownHooks();
  await app.listen(config.PORT, "0.0.0.0");
}

void bootstrap();
