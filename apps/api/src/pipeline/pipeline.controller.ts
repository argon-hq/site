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
}
