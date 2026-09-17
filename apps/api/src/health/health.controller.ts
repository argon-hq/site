import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { Public } from "../auth/public.decorator";
import { PrismaService } from "../prisma/prisma.service";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  // Also proves the database is reachable, so a broken DATABASE_URL shows up here first.
  @Public()
  @Get()
  async get() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      throw new ServiceUnavailableException({ ok: false, database: String(error) });
    }
    return { ok: true, database: true };
  }
}
