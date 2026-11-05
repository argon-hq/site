// Local .env first; in AWS the variables come from the function and the Parameter Store
// (src/lambda/main.ts), and dotenv changes nothing.
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
  // One proxy in front: on Lambda, the Web Adapter in the image, which passes on the headers of the
  // invocation. `req.ip` is the address they forward, not the adapter's own. The public routes count
  // their rate limit by it.
  app.set("trust proxy", 1);
  // CloudFront is in front of the API function (src/net/cloudfront.ts): only what came through it
  // passes, and the visitor's address is the one CloudFront wrote.
  if (config.ORIGIN_VERIFY_SECRET) app.use(cloudFrontOrigin(config.ORIGIN_VERIFY_SECRET));
  // The static site calls the subscriber routes from the visitor's browser: its origin, and only
  // its origin, may read the answers. No credentials travel — the routes need none.
  app.enableCors({
    origin: config.WEB_ORIGIN,
    methods: ["GET", "POST"],
    allowedHeaders: ["content-type"],
    maxAge: 600,
  });
  app.enableShutdownHooks();
  await app.listen(config.PORT, "0.0.0.0");
}

void bootstrap();
