import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { Effect } from "effect";
import { z } from "zod";
import { summaryOf } from "../ingest/ingest";
import { runEffect } from "../effect/nest";
import { ZodBody } from "../validation/zod-body.pipe";
import { OwnerAlert } from "./owner-alert";
import { PipelineService } from "./pipeline.service";

// Every route takes the same optional body. Without it the run does what the environment's profile
// says; with it, a lab or a development machine can pay for a real run once without a deploy.
// Production ignores `mock` — `resolveMode` refuses it there.
const stepBody = z.object({ mode: z.enum(["live", "mock"]).optional() }).default({});
type StepBody = z.infer<typeof stepBody>;

// The ingestion also takes the manual command's switches: read without writing, judge again what
// earlier runs listed, or one source's domain only.
const ingestBody = z
  .object({
    mode: z.enum(["live", "mock"]).optional(),
    dryRun: z.boolean().optional(),
    ignoreSeen: z.boolean().optional(),
    source: z.string().trim().min(1).max(253).optional(),
  })
  .default({});
type IngestBody = z.infer<typeof ingestBody>;

// The send may also name a day, to resume an edition a run left `sending` after the calendar moved
// on: "YYYY-MM-DD", the São Paulo calendar day, as the edition column stores it.
const sendBody = z.object({ date: z.iso.date().optional() }).default({});
type SendBody = z.infer<typeof sendBody>;

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

  // POST /pipeline/ingest { mode?, dryRun?, ignoreSeen?, source? } → reads the sources' feeds and
  // stores today's fichas now. The answer carries the counts, per address; item by item is the
  // debug log's, or `pnpm ingest:run`'s. Internal secret required.
  @Post("ingest")
  @HttpCode(200)
  ingest(@Body(ZodBody(ingestBody)) body: IngestBody) {
    return runEffect("ingest", this.alert.onFailure("ingest", this.pipeline.ingest(body).pipe(Effect.map(summaryOf))));
  }

  // POST /pipeline/write { mode? } → writes today's edition from the fichas the ingestion stored. Internal secret required.
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

  // POST /pipeline/send { date? } → sends the built edition to every confirmed subscriber, in
  // batches: today's, or the day named. It is what the 7h schedule fires; by hand it is the same
  // send, and running it again only picks up what is still pending. No model either way, so the mode
  // changes nothing. Internal secret required.
  @Post("send")
  @HttpCode(200)
  send(@Body(ZodBody(sendBody)) body: SendBody) {
    const date = body.date ? new Date(`${body.date}T00:00:00Z`) : undefined;
    return runEffect("send", this.alert.onFailure("send", this.pipeline.send({ date })));
  }
}
