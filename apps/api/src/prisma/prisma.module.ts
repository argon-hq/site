import { DynamicModule, Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

// Global: any module injects PrismaService without importing this one.
@Global()
@Module({})
export class PrismaModule {
  static forRoot(databaseUrl: string): DynamicModule {
    return {
      module: PrismaModule,
      providers: [{ provide: PrismaService, useFactory: () => new PrismaService(databaseUrl) }],
      exports: [PrismaService],
    };
  }
}
