import { Controller, Get, Logger, ServiceUnavailableException } from "@nestjs/common";
import { Public } from "../auth/public.decorator";
import { PrismaService } from "../prisma/prisma.service";

@Controller("health")
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  // Also proves the database is reachable, so a broken DATABASE_URL shows up here first — in the
  // log. The route is public, so the answer says only whether, never why.
  @Public()
  @Get()
  async get() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      this.logger.error({ msg: "database unreachable", reason: String(error) });
      throw new ServiceUnavailableException({ ok: false, database: false });
    }
    return { ok: true, database: true };
  }
}
