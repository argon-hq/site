import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { z } from "zod";
import { runEffect } from "../effect/nest";
import { ZodBody } from "../validation/zod-body.pipe";
import { OwnerAlert } from "./owner-alert";
import { PipelineService } from "./pipeline.service";

// Every route takes the same optional body. Without it the run does what the environment's profile
// says; with it, a lab or a development machine can pay for a real run once without a deploy.
// Production ignores `mock` — `resolveMode` refuses it there.
const stepBody = z.object({ mode: z.enum(["live", "mock"]).optional() }).default({});
type StepBody = z.infer<typeof stepBody>;

@Controller("pipeline")
export class PipelineController {
  constructor(
    private readonly pipeline: PipelineService,
    private readonly alert: OwnerAlert,
  ) {}

  // POST /pipeline/run { mode? } → the whole generation, as one run of the `edition` workflow. It is
  // what the 5h30 schedule fires; by hand it is the same run. Internal secret required.
  @Post("run")
  @HttpCode(200)
  run(@Body(ZodBody(stepBody)) body: StepBody) {
    return runEffect("run", this.pipeline.run(body));
  }

  // The routes below are the steps on their own, for debugging. A step carries no alert of its own,
  // so the boundary adds it here: by hand, one failure is still one e-mail to the owners.

  // POST /pipeline/collect { mode? } → runs the collection step now. Internal secret required.
  @Post("collect")
  @HttpCode(200)
  collect(@Body(ZodBody(stepBody)) body: StepBody) {
    return runEffect("collect", this.alert.onFailure("collect", this.pipeline.collect(body)));
  }

  // POST /pipeline/write { mode? } → writes today's edition from what the collection stored. Internal secret required.
  @Post("write")
  @HttpCode(200)
  write(@Body(ZodBody(stepBody)) body: StepBody) {
    return runEffect("write", this.alert.onFailure("write", this.pipeline.write(body)));
  }

  // POST /pipeline/build → builds and validates the e-mail of today's edition. No model either way,
  // so the mode changes nothing here. Internal secret required.
  @Post("build")
  @HttpCode(200)
  build() {
    return runEffect("build", this.alert.onFailure("build", this.pipeline.build()));
  }
}
