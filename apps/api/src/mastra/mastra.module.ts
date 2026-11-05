import { Global, Module } from "@nestjs/common";
import { mastra } from ".";
import { MASTRA } from "./token";

// The Mastra instance, for the services that run the agent and the workflow. It is provided here,
// on its own, because the `MastraModule` of `@mastra/nestjs` — which also provides it — mounts the
// Mastra routes under /mastra, and those exist only for the Studio, which only a development machine
// serves (app.module.ts). The pipeline runs the same everywhere, routes or not.
@Global()
@Module({
  providers: [{ provide: MASTRA, useValue: mastra }],
  exports: [MASTRA],
})
export class MastraInstanceModule {}
