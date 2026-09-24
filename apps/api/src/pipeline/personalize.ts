import { unsubscribeTokenFor } from "../subscriber/token";
import { UNSUBSCRIBE_PLACEHOLDER, unsubscribeHeaders, type Origins } from "../subscriber/urls";

// One subscriber, as the sending step knows them: who to send to, and which delivery row the answer
// belongs to. The unsubscribe token is not here: it is derived from the id when the copy is made.
export type Recipient = { subscriberId: string; email: string };

// What is actually sent to one subscriber. The stored edition is one e-mail for everyone and carries
// UNSUBSCRIBE_PLACEHOLDER where each subscriber's token belongs, so this is where what was stored
// becomes what goes out. Nothing reaches the provider without passing through here.
export type StoredEdition = { html: string; text: string };

// Not every copy can be personalised. A copy with no place for the token, or one that still carries
// the marker after the substitution, must never reach the provider: an edition whose unsubscribe
// link does not work is worse than one that did not arrive. Failing to personalise is an outcome
// for that one subscriber — like an article the writing step rejected — and not a failure of the
// step: everyone else still gets the edition.
export type Personalization =
  | { outcome: "ready"; html: string; text: string; headers: Record<string, string> }
  | { outcome: "unpersonalizable"; reason: string };

// The marker as the building step wrote it into the URL, so the same substitution serves both
// copies. The token is base64url and a dot, so it needs no escaping there; encoded anyway, so the
// two can never disagree.
export function personalize(
  edition: StoredEdition,
  recipient: Recipient,
  origins: Origins,
  secret: string,
): Personalization {
  if (!edition.html.includes(UNSUBSCRIBE_PLACEHOLDER) || !edition.text.includes(UNSUBSCRIBE_PLACEHOLDER)) {
    return { outcome: "unpersonalizable", reason: "stored edition carries no unsubscribe marker" };
  }
  const token = unsubscribeTokenFor(secret, recipient.subscriberId);
  const encoded = encodeURIComponent(token);
  const html = edition.html.split(UNSUBSCRIBE_PLACEHOLDER).join(encoded);
  const text = edition.text.split(UNSUBSCRIBE_PLACEHOLDER).join(encoded);
  if (html.includes(UNSUBSCRIBE_PLACEHOLDER) || text.includes(UNSUBSCRIBE_PLACEHOLDER)) {
    return { outcome: "unpersonalizable", reason: "unsubscribe marker survived the substitution" };
  }
  return { outcome: "ready", html, text, headers: unsubscribeHeaders(origins, token) };
}
