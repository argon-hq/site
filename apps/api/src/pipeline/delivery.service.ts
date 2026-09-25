import { Inject, Injectable, Logger } from "@nestjs/common";
import { Data, Effect } from "effect";
import { CONFLICT, type Failure } from "../effect/failure";
import { MailService } from "../mail/mail.service";
import type { BatchDelivery, Message } from "../mail/mail.types";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../settings/settings.service";
import { UNSUBSCRIBE_SECRET } from "../subscriber/token";
import { ORIGINS, type Origins } from "../subscriber/urls";
import { personalize } from "./personalize";
import {
  assignBatches,
  batchKey,
  BATCH_SIZE,
  BatchRefused,
  closeEdition,
  countPending,
  countSettled,
  createDeliveries,
  deliverBatch,
  highestBatch,
  loadSendable,
  markSending,
  newRecipients,
  pendingBatches,
  recordBatch,
  SendDbFailed,
  type PendingBatch,
  type SendableEdition,
} from "./send";

export class SendFailed extends Data.TaggedError("SendFailed")<Failure> {}

// One batch as the report sees it. Which row failed and why is not here on purpose: an edition can
// carry thousands of rows, and the reason is already on the row, in `delivery.error`.
export type BatchOutcome = { batch: number; size: number; sent: number; failed: number };

export type SendReport = {
  date: string;
  editionId: string;
  // Where the edition ended up, which is how an operator reads "did it finish".
  status: "sent" | "sending";
  // Rows still owed when this run started, how many of those it created, and how many an earlier
  // run had already settled. Together they tell a resume apart from a first run at a glance.
  recipients: number;
  created: number;
  alreadySent: number;
  batches: BatchOutcome[];
  sent: number;
  failed: number;
  durationMs: number;
};

// The distributor: no model and no judgement, like the building step. The edition the building step
// left becomes one message per confirmed subscriber, handed to the provider in batches. It is a run
// of its own, at 7h, and not a fourth step of the generation workflow: the edition is ready long
// before it, and a resend has nothing to do with generating anything. The helpers in send.ts are
// the pieces; this is the order they go in.
@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly mail: MailService,
    @Inject(ORIGINS) private readonly origins: Origins,
    @Inject(UNSUBSCRIBE_SECRET) private readonly unsubscribeSecret: string,
  ) {}

  // The whole send of one edition: the rows, the batches, the close. Called holding the edition's
  // lock, by PipelineService, which also keeps the one-send-at-a-time gate.
  send(date: Date, now: Date): Effect.Effect<SendReport, SendFailed> {
    return Effect.gen(this, function* () {
      const startedAt = Date.now();
      const settings = yield* Effect.tryPromise({
        try: () => this.settings.load(),
        catch: (error) => new SendFailed({ reason: `settings: ${String(error)}` }),
      });
      const day = date.toISOString().slice(0, 10);
      const failed = (error: Failure) => new SendFailed({ reason: error.reason, status: error.status });

      // The kill switch, read from the database immediately before anything leaves. A paused send
      // writes nothing at all, so it is a failure of the step and not an outcome of it — which is
      // what puts it on the one alert path without an alert inside the step.
      if (settings.sending_paused) {
        return yield* new SendFailed({
          reason: `sending paused: edition ${day} did not go out because sending_paused is on`,
          status: CONFLICT,
        });
      }

      const edition = yield* loadSendable(this.prisma, date).pipe(Effect.mapError(failed));
      // On its way out before the first row exists: a run that dies here leaves an edition the next
      // send resumes, instead of one the building step would quietly rebuild over.
      yield* markSending(this.prisma, { editionId: edition.id }).pipe(Effect.mapError(failed));

      // Whoever confirmed since the last run starts a batch after the highest one already handed
      // out. Adding them to a batch that already went out would change what that key stands for.
      const from = yield* highestBatch(this.prisma, { editionId: edition.id }).pipe(Effect.mapError(failed));
      const recipients = yield* newRecipients(this.prisma, { editionId: edition.id }).pipe(Effect.mapError(failed));
      yield* createDeliveries(this.prisma, {
        editionId: edition.id,
        rows: assignBatches(recipients, from),
      }).pipe(Effect.mapError(failed));

      const settled = yield* countSettled(this.prisma, { editionId: edition.id }).pipe(Effect.mapError(failed));
      const batches = yield* pendingBatches(this.prisma, { editionId: edition.id }).pipe(Effect.mapError(failed));
      const waiting = batches.reduce((total, batch) => total + batch.rows.length, 0);
      this.logger.log({
        msg: "send started",
        date: day,
        edition: edition.id,
        recipients: waiting,
        created: recipients.length,
        alreadySent: settled,
        batches: batches.length,
        batchSize: BATCH_SIZE,
      });

      // One batch at a time, which is `Effect.forEach`'s default and has to stay that way. Each
      // batch is a hundred-message call against a provider with a request-rate limit, so going wide
      // buys throughput a newsletter does not need and makes a 429 likely; sequential is also what
      // leaves a clean prefix of settled batches when a run dies, which is what the resume reads.
      const outcomes = yield* Effect.forEach(batches, (batch) => this.sendOneBatch(edition, batch, now)).pipe(
        Effect.mapError(failed),
      );

      const pending = yield* countPending(this.prisma, { editionId: edition.id }).pipe(Effect.mapError(failed));
      if (pending === 0) yield* closeEdition(this.prisma, { editionId: edition.id, now }).pipe(Effect.mapError(failed));

      const report: SendReport = {
        date: day,
        editionId: edition.id,
        status: pending === 0 ? "sent" : "sending",
        recipients: waiting,
        created: recipients.length,
        alreadySent: settled,
        batches: outcomes,
        sent: outcomes.reduce((total, batch) => total + batch.sent, 0),
        failed: outcomes.reduce((total, batch) => total + batch.failed, 0),
        durationMs: Date.now() - startedAt,
      };
      // An edition with nobody to send it to is not a failure: lab and a development machine hit it
      // constantly. It closes as sent, and the warning is what says the list was empty.
      if (waiting === 0) this.logger.warn({ msg: "edition sent to nobody", date: day, edition: edition.id });
      this.logger.log({ msg: "send finished", ...report });
      return report;
    });
  }

  // One batch: the stored edition becomes one message per row, the provider answers one result per
  // message, and the whole answer is written in a single transaction — a batch settles or it does
  // not. A row that cannot be personalised never enters the payload: it settles as failed on its own.
  // So does a row whose subscriber is no longer confirmed: the rows were created when the run
  // started, and a run can be resumed hours later, so the status is read again here, right before
  // the address would leave. The kill switch is read again for the same reason.
  private sendOneBatch(
    edition: SendableEdition,
    batch: PendingBatch,
    now: Date,
  ): Effect.Effect<BatchOutcome, SendDbFailed | BatchRefused | SendFailed> {
    return Effect.gen(this, function* () {
      const paused = yield* Effect.tryPromise({
        try: () => this.settings.get("sending_paused"),
        catch: (error) => new SendDbFailed({ reason: `settings: ${String(error)}` }),
      });
      if (paused) {
        return yield* new SendFailed({
          reason: `sending paused before batch ${batch.batch}: sending_paused is on`,
          status: CONFLICT,
        });
      }

      const results: { id: string; result: BatchDelivery }[] = [];
      const messages: Message[] = [];
      // The delivery row each message belongs to, in the same order: the provider answers by
      // position and nothing else links an id back to a subscriber.
      const addressed: string[] = [];

      for (const row of batch.rows) {
        if (row.recipient.status !== "confirmed") {
          results.push({
            id: row.id,
            result: { outcome: "refused", reason: `subscriber is ${row.recipient.status}, not confirmed` },
          });
          continue;
        }
        const copy = personalize(edition, row.recipient, this.origins, this.unsubscribeSecret);
        if (copy.outcome === "unpersonalizable") {
          results.push({ id: row.id, result: { outcome: "refused", reason: copy.reason } });
          continue;
        }
        addressed.push(row.id);
        messages.push({
          to: row.recipient.email,
          subject: edition.subject,
          html: copy.html,
          text: copy.text,
          headers: copy.headers,
        });
      }

      // A transport that delivers one message at a time settles each row as it goes, so a run that
      // dies mid-batch leaves the rows already delivered marked and only the rest pending. A
      // transport with a batch endpoint answers all at once, and the key makes a repeat safe.
      const settled = new Set<string>();
      const onSettled = (index: number, result: BatchDelivery) => {
        const id = addressed[index];
        if (id === undefined) return Promise.resolve();
        settled.add(id);
        return Effect.runPromise(recordBatch(this.prisma, { rows: [{ id, result }], now }));
      };

      const answers =
        messages.length === 0
          ? []
          : yield* deliverBatch(this.mail, { messages, idempotencyKey: batchKey(edition.id, batch.batch), onSettled });

      // The transport owes one result per message. If it ever does not, stop: writing the answers
      // out of step would put one subscriber's provider id on another subscriber's row.
      if (answers.length !== messages.length) {
        return yield* new BatchRefused({
          reason: `batch ${batch.batch} of edition ${edition.id} got ${answers.length} answer(s) for ${messages.length} message(s)`,
        });
      }
      answers.forEach((result, index) => results.push({ id: addressed[index] as string, result }));

      yield* recordBatch(this.prisma, { rows: results.filter((row) => !settled.has(row.id)), now });

      const refused = results.filter((row) => row.result.outcome === "refused");
      for (const row of refused) {
        if (row.result.outcome === "refused") {
          this.logger.warn({
            msg: "delivery failed",
            edition: edition.id,
            delivery: row.id,
            reason: row.result.reason,
          });
        }
      }
      return {
        batch: batch.batch,
        size: results.length,
        sent: results.length - refused.length,
        failed: refused.length,
      };
    });
  }
}
