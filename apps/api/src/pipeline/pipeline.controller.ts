import { Controller, HttpCode, Post } from "@nestjs/common";
import { runEffect } from "../effect/nest";
import { PipelineService } from "./pipeline.service";

@Controller("pipeline")
export class PipelineController {
  constructor(private readonly pipeline: PipelineService) {}

  // POST /pipeline/collect → runs the collection step now. Internal secret required.
  @Post("collect")
  @HttpCode(200)
  collect() {
    return runEffect("collect", this.pipeline.collect());
  }

  // POST /pipeline/write → writes today's edition from what the collection stored. Internal secret required.
  @Post("write")
  @HttpCode(200)
  write() {
    return runEffect("write", this.pipeline.write());
  }

  // POST /pipeline/build → builds and validates the e-mail of today's edition. Internal secret required.
  @Post("build")
  @HttpCode(200)
  build() {
    return runEffect("build", this.pipeline.build());
  }
}
