import { Controller, HttpCode, Post } from "@nestjs/common";
import { runEffect } from "../effect/nest";
import { OwnerAlert } from "./owner-alert";
import { PipelineService } from "./pipeline.service";

@Controller("pipeline")
export class PipelineController {
  constructor(
    private readonly pipeline: PipelineService,
    private readonly alert: OwnerAlert,
  ) {}

  // POST /pipeline/run → the whole generation, as one run of the `edition` workflow. It is what the
  // 5h30 schedule fires; by hand it is the same run. Internal secret required.
  @Post("run")
  @HttpCode(200)
  run() {
    return runEffect("run", this.pipeline.run());
  }

  // The routes below are the steps on their own, for debugging. A step carries no alert of its own,
  // so the boundary adds it here: by hand, one failure is still one e-mail to the owners.

  // POST /pipeline/collect → runs the collection step now. Internal secret required.
  @Post("collect")
  @HttpCode(200)
  collect() {
    return runEffect("collect", this.alert.onFailure("collect", this.pipeline.collect()));
  }

  // POST /pipeline/write → writes today's edition from what the collection stored. Internal secret required.
  @Post("write")
  @HttpCode(200)
  write() {
    return runEffect("write", this.alert.onFailure("write", this.pipeline.write()));
  }

  // POST /pipeline/build → builds and validates the e-mail of today's edition. Internal secret required.
  @Post("build")
  @HttpCode(200)
  build() {
    return runEffect("build", this.alert.onFailure("build", this.pipeline.build()));
  }
}
