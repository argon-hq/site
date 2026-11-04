import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { z } from "zod";
import { Public } from "../auth/public.decorator";
import { ZodBody } from "../validation/zod-body.pipe";
import { RetentionScheduler } from "./retention";
import { PipelineScheduler } from "./scheduler";

// The jobs of the day, by name, for the Lambda that runs them (deploy/aws/lambda.tf). EventBridge
// Scheduler invokes that function with { "job": "<name>" } at the hours the @Cron decorators keep
// on the EC2, and the Lambda Web Adapter hands any event that is not HTTP to POST /events. Each job
// is the same method the clock calls, so a job run by a schedule and one run by the clock log,
// alert and fail alike.
export const JOBS = ["edition", "send", "watch", "retention", "sunday-edition", "sunday-send"] as const;
export const jobBody = z.object({ job: z.enum(JOBS) });
type JobBody = z.infer<typeof jobBody>;

// Public because the adapter posts without the internal secret. The route only exists where
// JOBS_ENABLED is on, which is the jobs function alone: it has no URL, so the only way in is an
// invocation that IAM allowed — the schedule, or an operator with the AWS credentials.
@Controller("events")
export class JobsController {
  constructor(
    private readonly pipeline: PipelineScheduler,
    private readonly retention: RetentionScheduler,
  ) {}

  // The answer waits for the job: Lambda freezes the process once it is sent, so nothing may still
  // be running behind it. A job that fails has already alerted the owners, as on the clock.
  @Public()
  @Post()
  @HttpCode(200)
  async run(@Body(ZodBody(jobBody)) { job }: JobBody) {
    switch (job) {
      case "edition":
        await this.pipeline.generate();
        break;
      case "send":
        await this.pipeline.send();
        break;
      case "watch":
        await this.pipeline.watchEditions();
        break;
      case "retention":
        await this.retention.nightly();
        break;
      case "sunday-edition":
        this.pipeline.sundayGenerate();
        break;
      case "sunday-send":
        this.pipeline.sundaySend();
        break;
    }
    return { job, done: true };
  }
}
