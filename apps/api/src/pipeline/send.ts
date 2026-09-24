import { Data, Effect } from "effect";
import { dbEffect } from "../effect/db";
import { CONFLICT, NOT_FOUND, type Failure } from "../effect/failure";
import type { PrismaClient } from "../generated/prisma/client";
import type { MailService } from "../mail/mail.service";
import type { BatchDelivery, Message, OnSettled } from "../mail/mail.types";
import type { Recipient } from "./personalize";

// How many messages go to the provider in one call. Ours to enforce: the SDK chunks nothing and
// imposes no ceiling of its own.
export const BATCH_SIZE = 100;

export class SendDbFailed extends Data.TaggedError("SendDbFailed")<Failure> {}
export class BatchRefused extends Data.TaggedError("BatchRefused")<{ reason: string }> {}

const db = dbEffect((reason) => new SendDbFailed({ reason }));

// The edition as the sending step needs it: the subject it goes out under and the two copies the
// building step stored, one e-mail for everyone.
export type SendableEdition = { id: string; subject: string; html: string; text: string };

// One delivery still waiting, and who it is waiting for — with the status the subscriber has now,
// not the one they had when the row was created.
export type PendingRow = { id: string; batch: number; recipient: PendingRecipient };
export type PendingRecipient = Recipient & { status: string };
export type PendingBatch = { batch: number; rows: PendingRow[] };

// A batch is all-or-nothing at the row level: either the provider answered and every row of that
// batch moved to `sent` or `failed`, or it did not and every row of it is still `pending`. That is
// what makes the idempotency key honest — a resumed batch carries exactly the members the first
// attempt carried, so the same key still describes the same payload. Three things keep it true, and
// all three are easy to undo by accident: batch numbers are assigned at row creation and never
// recomputed, a subscriber who confirms later starts a batch of their own, and the rows of a batch
// keep a stable order.

// Read, never create: without a built edition there is nothing to send. `sending` is accepted, where
// the writing and building steps refuse it, because it is the state a run that stopped halfway
// leaves behind and another send is the only way out. `sent` is refused: it is written only once
// nothing is pending, so there is nothing left to resume.
export const loadSendable = (prisma: PrismaClient, date: Date): Effect.Effect<SendableEdition, SendDbFailed> => {
  const day = date.toISOString().slice(0, 10);
  return db(() =>
    prisma.edition.findUnique({
      where: { date },
      select: { id: true, status: true, subject: true, html: true, text: true },
    }),
  ).pipe(
    Effect.flatMap((row) =>
      row === null
        ? new SendDbFailed({ reason: `edition ${day} does not exist yet`, status: NOT_FOUND })
        : Effect.succeed(row),
    ),
    Effect.filterOrFail(
      (row) => row.status === "ready" || row.status === "sending",
      (row) => new SendDbFailed({ reason: `edition ${day} is ${row.status}, not ready to send`, status: CONFLICT }),
    ),
    // The three columns are nullable and a ready edition always carries them, so this is what
    // catches a row someone edited by hand — and what makes them strings without a cast.
    Effect.flatMap((row) =>
      row.subject === null || row.html === null || row.text === null
        ? new SendDbFailed({ reason: `edition ${day} has no built e-mail`, status: CONFLICT })
        : Effect.succeed({ id: row.id, subject: row.subject, html: row.html, text: row.text }),
    ),
  );
};

// `ready` → `sending`, before the first delivery row exists. A run that dies after this leaves an
// edition the next send resumes, rather than one the building step would quietly rebuild over.
export const markSending = (prisma: PrismaClient, p: { editionId: string }): Effect.Effect<void, SendDbFailed> =>
  db(() => prisma.edition.update({ where: { id: p.editionId }, data: { status: "sending" } })).pipe(Effect.asVoid);

// Who is still owed this edition: confirmed, and with no delivery row for it yet. Asked in a stable
// order, because which subscribers end up sharing a batch must not depend on the order the database
// happened to return them in.
export const newRecipients = (
  prisma: PrismaClient,
  p: { editionId: string },
): Effect.Effect<Recipient[], SendDbFailed> =>
  db(() =>
    prisma.subscriber.findMany({
      where: { status: "confirmed", deliveries: { none: { editionId: p.editionId } } },
      select: { id: true, email: true },
      orderBy: { id: "asc" },
    }),
  ).pipe(Effect.map((rows) => rows.map((row) => ({ subscriberId: row.id, email: row.email }))));

// The last batch number this edition has handed out, so the next one starts after it.
export const highestBatch = (prisma: PrismaClient, p: { editionId: string }): Effect.Effect<number, SendDbFailed> =>
  db(() => prisma.delivery.aggregate({ where: { editionId: p.editionId }, _max: { batch: true } })).pipe(
    Effect.map((row) => row._max.batch ?? 0),
  );

// Every row exists, pending, before anything reaches the provider: the queue is whatever the
// database calls pending, so a run that dies mid-flight still knows who it owes. `skipDuplicates`
// against the unique pair is what makes a second run create nothing.
export const createDeliveries = (
  prisma: PrismaClient,
  p: { editionId: string; rows: { subscriberId: string; batch: number }[] },
): Effect.Effect<void, SendDbFailed> =>
  p.rows.length === 0
    ? Effect.void
    : db(() =>
        prisma.delivery.createMany({
          data: p.rows.map((row) => ({ editionId: p.editionId, subscriberId: row.subscriberId, batch: row.batch })),
          skipDuplicates: true,
        }),
      ).pipe(Effect.asVoid);

// What is still waiting, grouped by the batch each row was given when it was created.
export const pendingBatches = (
  prisma: PrismaClient,
  p: { editionId: string },
): Effect.Effect<PendingBatch[], SendDbFailed> =>
  db(() =>
    prisma.delivery.findMany({
      where: { editionId: p.editionId, status: "pending" },
      select: { id: true, batch: true, subscriber: { select: { id: true, email: true, status: true } } },
      orderBy: [{ batch: "asc" }, { id: "asc" }],
    }),
  ).pipe(
    Effect.map((rows) =>
      groupByBatch(
        rows.map((row) => ({
          id: row.id,
          batch: row.batch,
          recipient: { subscriberId: row.subscriber.id, email: row.subscriber.email, status: row.subscriber.status },
        })),
      ),
    ),
  );

// One transaction for the whole batch, so a batch settles or it does not. A row the provider took
// carries its id and the time it went out; a row it refused carries the reason and is settled, so a
// later run leaves it alone. A batch that never got an answer does not come through here at all:
// its rows stay pending, because `failed` means the provider looked at this one message and said no.
export const recordBatch = (
  prisma: PrismaClient,
  p: { rows: { id: string; result: BatchDelivery }[]; now: Date },
): Effect.Effect<void, SendDbFailed> =>
  p.rows.length === 0
    ? Effect.void
    : db(() =>
        prisma.$transaction(
          p.rows.map(({ id, result }) =>
            prisma.delivery.update({
              where: { id },
              data:
                result.outcome === "sent"
                  ? { status: "sent", providerEmailId: result.id, sentAt: p.now, error: null }
                  : { status: "failed", error: result.reason },
            }),
          ),
        ),
      ).pipe(Effect.asVoid);

export const countPending = (prisma: PrismaClient, p: { editionId: string }): Effect.Effect<number, SendDbFailed> =>
  db(() => prisma.delivery.count({ where: { editionId: p.editionId, status: "pending" } }));

// What an earlier run already settled. Only the log reads it, and it is what tells a resume from a
// first run at a glance: eighty already out, twenty to go.
export const countSettled = (prisma: PrismaClient, p: { editionId: string }): Effect.Effect<number, SendDbFailed> =>
  db(() => prisma.delivery.count({ where: { editionId: p.editionId, status: { not: "pending" } } }));

// The edition is out: nothing is pending any more. `sent` is what the writing and building steps
// refuse to touch, and `sentAt` is what the archive reads.
export const closeEdition = (
  prisma: PrismaClient,
  p: { editionId: string; now: Date },
): Effect.Effect<void, SendDbFailed> =>
  db(() => prisma.edition.update({ where: { id: p.editionId }, data: { status: "sent", sentAt: p.now } })).pipe(
    Effect.asVoid,
  );

// The one call that leaves the API. A batch the provider refused whole is a failure of the step:
// nothing was delivered, and the rows it names stay pending for the next run.
export const deliverBatch = (
  mail: Pick<MailService, "sendBatch">,
  p: { messages: Message[]; idempotencyKey: string; onSettled?: OnSettled },
): Effect.Effect<BatchDelivery[], BatchRefused> =>
  Effect.tryPromise({
    try: () => mail.sendBatch(p.messages, { idempotencyKey: p.idempotencyKey, onSettled: p.onSettled }),
    catch: (error) => new BatchRefused({ reason: String(error) }),
  }).pipe(Effect.map((sent) => sent.results));

// Batch numbers are decided once, here, and then frozen on the row. The send loop groups by what it
// reads and never chunks again: a resumed batch must have exactly the members the first attempt had,
// or its idempotency key stands for a payload that no longer exists.
export function assignBatches(recipients: Recipient[], from: number): { subscriberId: string; batch: number }[] {
  return recipients.map((recipient, index) => ({
    subscriberId: recipient.subscriberId,
    batch: from + 1 + Math.floor(index / BATCH_SIZE),
  }));
}

// Rows arrive ordered by batch and then by id, so grouping preserves both the order of the batches
// and the order inside each one. A batch with the same members in a different order is a different
// payload as far as the provider's key is concerned.
export function groupByBatch(rows: PendingRow[]): PendingBatch[] {
  const batches: PendingBatch[] = [];
  for (const row of rows) {
    const last = batches.at(-1);
    if (last?.batch === row.batch) last.rows.push(row);
    else batches.push({ batch: row.batch, rows: [row] });
  }
  return batches;
}

// What the provider dedupes on: this edition, this batch.
export function batchKey(editionId: string, batch: number): string {
  return `${editionId}:${batch}`;
}
