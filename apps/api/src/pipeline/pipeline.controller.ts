import { Controller, HttpCode, InternalServerErrorException, Post } from "@nestjs/common";
import { Cause, Effect, Exit } from "effect";
import { PipelineService } from "./pipeline.service";

@Controller("pipeline")
export class PipelineController {
  constructor(private readonly pipeline: PipelineService) {}

  // POST /pipeline/collect → runs the collection step now. Internal secret required.
  @Post("collect")
  @HttpCode(200)
  async collect() {
    const exit = await Effect.runPromiseExit(this.pipeline.collect());
    return Exit.match(exit, {
      onSuccess: (report) => report,
      onFailure: (cause) => {
        const failure = Cause.failureOption(cause);
        const reason = failure._tag === "Some" ? failure.value.reason : Cause.pretty(cause);
        throw new InternalServerErrorException({ step: "collect", reason });
      },
    });
  }
}
