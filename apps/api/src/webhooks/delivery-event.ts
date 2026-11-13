import { z } from "zod";
import type { DeliveryStatus } from "../generated/prisma/client";

// What the delivery webhook needs from a Resend event: its type, the provider's id of the message
// (the one the sending step stored in `delivery.provider_email_id`) and, for a bounce, its kind.
// Everything else the provider sends is ignored, and an event without an e-mail id is not ours.
const eventSchema = z.object({
  type: z.string().startsWith("email."),
  // When the provider recorded the event; a malformed one reads as unknown, not as a refusal.
  created_at: z.iso.datetime({ offset: true }).optional().catch(undefined),
  data: z.object({
    email_id: z.string().min(1).max(200),
    bounce: z.object({ type: z.string() }).partial().optional(),
  }),
});

export type DeliveryEvent = { type: string; emailId: string; bounceType?: string; createdAt?: Date };

export function parseEvent(body: unknown): DeliveryEvent | null {
  const parsed = eventSchema.safeParse(body);
  if (!parsed.success) return null;
  const { type, data, created_at: createdAt } = parsed.data;
  const bounceType = data.bounce?.type;
  return {
    type,
    emailId: data.email_id,
    ...(bounceType === undefined ? {} : { bounceType }),
    ...(createdAt === undefined ? {} : { createdAt: new Date(createdAt) }),
  };
}

// The status an event moves a row to, and the statuses it may move it from. The row only moves
// forward (schema.prisma), so the sources are what makes the webhook safe to receive twice and out
// of order: a delivery that arrives after a bounce finds no row in a status it may leave, and the
// same event delivered again finds the row already where it put it.
export type Transition = { to: DeliveryStatus; from: DeliveryStatus[] };

const DELIVERED: Transition = { to: "delivered", from: ["sent"] };
// A permanent bounce can arrive after `delivered`: the receiving server accepted, then returned it.
const HARD_BOUNCE: Transition = { to: "hard_bounce", from: ["sent", "delivered", "soft_bounce"] };
// One transient bounce does not give up on the address; it counts in `subscriber.soft_bounces`.
const SOFT_BOUNCE: Transition = { to: "soft_bounce", from: ["sent"] };
// A spam complaint comes after the message was delivered, and wins over anything else.
const COMPLAINT: Transition = { to: "complaint", from: ["sent", "delivered", "soft_bounce", "hard_bounce"] };
// The provider accepted the message and then could not send it.
const FAILED: Transition = { to: "failed", from: ["sent"] };

export function transitionFor(event: DeliveryEvent): Transition | null {
  switch (event.type) {
    case "email.delivered":
      return DELIVERED;
    case "email.bounced":
      return event.bounceType === "Permanent" ? HARD_BOUNCE : SOFT_BOUNCE;
    case "email.complained":
      return COMPLAINT;
    // The provider refused it because the address is on its suppression list, after an earlier
    // bounce or complaint: it will never deliver there, which is what a hard bounce means here.
    case "email.suppressed":
      return HARD_BOUNCE;
    case "email.failed":
      return FAILED;
    // sent, delivery_delayed, opened, clicked, scheduled: nothing final about the delivery.
    default:
      return null;
  }
}
