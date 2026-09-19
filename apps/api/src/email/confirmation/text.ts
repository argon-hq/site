import { copy } from "../copy";
import { wrap } from "../text";
import type { ConfirmationInput } from "../types";

export function renderText(input: ConfirmationInput): string {
  return [
    `${copy.brand.name} · ${copy.brand.tagline}`.toUpperCase(),
    "",
    copy.confirmation.heading,
    "",
    copy.confirmation.body,
    "",
    `${copy.confirmation.cta}: ${input.confirmUrl}`,
    "",
    copy.confirmation.expiry(input.expiresInHours),
    copy.confirmation.ignore,
    "",
    copy.signoff.line,
    copy.signoff.signature,
    "",
    `${input.sender.name} <${input.sender.address}> · ${input.sender.postalAddress}`,
    `${copy.text.privacy}: ${input.privacyPolicyUrl}`,
    "",
  ]
    .flatMap((line) => wrap(line))
    .join("\n");
}
