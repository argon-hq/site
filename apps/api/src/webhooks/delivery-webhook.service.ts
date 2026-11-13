import { Inject, Injectable, Logger } from "@nestjs/common";
import { Data, Effect } from "effect";
import { dbEffect } from "../effect/db";
import type { Failure } from "../effect/failure";
import type { DeliveryStatus, Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { transitionFor, type DeliveryEvent, type Transition } from "./delivery-event";

// A 500: the provider retries a webhook that did not answer 2xx, and the transitions are
// conditional, so the retry applies once whatever part of the first attempt got through.
export class DeliveryWebhookFailed extends Data.TaggedError("DeliveryWebhookFailed")<Failure> {}

const db = dbEffect((reason) => new DeliveryWebhookFailed({ reason }));

export type ApplyResult =
  // The event says nothing final about a delivery (opened, delayed, …).
  | { outcome: "ignored" }
  // No delivery carries that provider id: another sender on the same account, a confirmation
  // e-mail, or an edition already trimmed.
  | { outcome: "unknown" }
  // The row is already past where the event would put it: a repeat, or an older event late.
  | { outcome: "stale"; deliveryId: string }
  | { outcome: "applied"; deliveryId: string; status: DeliveryStatus };

type Tx = Prisma.TransactionClient;

// The second half of the distributor: what the provider says happened to each message after it
// accepted it. Until this, `sent` meant only "the provider took it" (README, "Pipeline").
@Injectable()
export class DeliveryWebhookService {
  private readonly logger = new Logger(DeliveryWebhookService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  apply(event: DeliveryEvent): Effect.Effect<ApplyResult, DeliveryWebhookFailed> {
    const transition = transitionFor(event);
    if (!transition) return Effect.succeed({ outcome: "ignored" } as const);

    return db(() => this.prisma.$transaction((tx) => this.move(tx, event.emailId, transition))).pipe(
      Effect.tap((result) => Effect.sync(() => this.log(event, result))),
    );
  }

  // The row and the subscriber change together or not at all. The update is conditional on the
  // row's status, so of two copies of one event — retried, or racing — only one moves the row, and
  // only that one touches the subscriber: the soft bounce is counted once.
  private async move(tx: Tx, emailId: string, transition: Transition): Promise<ApplyResult> {
    const row = await tx.delivery.findFirst({
      where: { providerEmailId: emailId },
      select: { id: true, subscriberId: true, status: true },
    });
    if (!row) return { outcome: "unknown" };

    const moved = await tx.delivery.updateMany({
      where: { id: row.id, status: { in: transition.from } },
      data: { status: transition.to },
    });
    if (moved.count === 0) return { outcome: "stale", deliveryId: row.id };

    await this.settleSubscriber(tx, row.subscriberId, transition.to);
    return { outcome: "applied", deliveryId: row.id, status: transition.to };
  }

  // What the delivery means for the address. `send.ts` writes only to confirmed subscribers, so a
  // bounced or blocked one is never written to again, and the sign-up ignores them (subscriber.service.ts).
  private async settleSubscriber(tx: Tx, subscriberId: string, status: DeliveryStatus): Promise<void> {
    switch (status) {
      case "soft_bounce":
        // Counted, not acted on: when enough soft bounces give up on an address is not decided yet.
        await tx.subscriber.update({ where: { id: subscriberId }, data: { softBounces: { increment: 1 } } });
        return;
      case "hard_bounce":
        // A complaint is the stronger mark and stays. A cancelled address becomes bounced too: it
        // is dead, and a sign-up that reopened it would only bounce again.
        await tx.subscriber.updateMany({
          where: { id: subscriberId, status: { not: "blocked" } },
          data: { status: "bounced" },
        });
        return;
      case "complaint":
        await tx.subscriber.update({ where: { id: subscriberId }, data: { status: "blocked" } });
        return;
      default:
        return;
    }
  }

  private log(event: DeliveryEvent, result: ApplyResult): void {
    const entry = { msg: "delivery webhook", type: event.type, emailId: event.emailId, ...result };
    if (result.outcome === "unknown") this.logger.warn(entry);
    else this.logger.log(entry);
  }
}
