import type { Deployment } from "./profile";

// One subscriber, as the sending step knows them: who to send to, and which delivery row the answer
// belongs to. ARG-114 adds the unsubscribe token here, next to the address it belongs to.
export type Recipient = { subscriberId: string; email: string };

// What is actually sent to one subscriber. The stored edition is one e-mail for everyone and carries
// UNSUBSCRIBE_PLACEHOLDER where each subscriber's token belongs, so this is where what was stored
// becomes what goes out. Nothing reaches the provider without passing through here.
export type StoredEdition = { html: string; text: string };

// Not every subscriber can be personalised. A copy that still carries the marker must never reach
// the provider, so failing to personalise is an outcome for that one subscriber — like an article
// the writing step rejected — and not a failure of the step: everyone else still gets the edition.
export type Personalization =
  | { outcome: "ready"; html: string; text: string; headers: Record<string, string> }
  | { outcome: "unpersonalizable"; reason: string };

// The raw unsubscribe token does not exist to be substituted. The database keeps only the SHA-256
// of the 32 random bytes issued at confirmation, and the token itself was discarded there, so there
// is nothing to read back. ARG-114 is what makes one available; until then the edition goes out
// exactly as it was stored, and `sendRefusal` is what keeps that away from real subscribers.
//
// No `List-Unsubscribe` either, and that is a decision rather than an omission. A one-click URI
// carrying the marker would have the mail client POST it on its own, fail the token lookup, and
// report success to the subscriber — an opt-out received and not honoured, which is worse than the
// header being absent. The footer link fails visibly instead: the page says the link is invalid, and
// the subscriber can still act.
//
// ARG-114 changes this function and the two lines below it. It takes the `Recipient` and the
// `Origins` as arguments, replaces the marker in both copies, fills `headers` from
// `unsubscribeHeaders`, and returns `unpersonalizable` when the marker survived the replacement.
export function personalize(edition: StoredEdition): Personalization {
  return { outcome: "ready", html: edition.html, text: edition.text, headers: {} };
}

// What the function above still does not do. Named after the fact it asserts and not after the
// guard it feeds, because `SUBSTITUTES_UNSUBSCRIBE_TOKEN = true` is a lie a reviewer can see.
export const SUBSTITUTES_UNSUBSCRIBE_TOKEN = false;

// The same deal `resolveMode` makes about a mocked run: the agents decide, the code imposes the
// rules. Outside production an edition that still carries the marker is exactly what lets the whole
// pipeline be exercised end to end; in production it would mail real subscribers an unsubscribe link
// that does not work, so the code refuses to send at all — no setting, no request body and no
// environment variable turns this off. The refusal disappears with ARG-114, which is why it lives in
// this file: the substitution and the guard are removed by the same diff.
export function sendRefusal(deployment: Deployment, substitutes: boolean): string | null {
  if (deployment !== "prod" || substitutes) return null;
  return "o envio ainda não substitui o marcador de descadastro por um token real (ARG-114); produção não envia assim";
}
