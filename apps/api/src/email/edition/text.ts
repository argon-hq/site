import { copy } from "../copy";
import { formatDate } from "../format";
import { wrap } from "../text";
import type { EditionInput } from "../types";

export function renderText(input: EditionInput): string {
  return [
    `${copy.brand.name} · ${copy.brand.tagline}`.toUpperCase(),
    `${copy.header.edition} · ${formatDate(input.date)}`,
    "",
    input.title,
    "",
    ...input.items.flatMap((item) => [
      item.category.toUpperCase(),
      item.headline,
      item.body,
      `${copy.item.readMore}: ${item.url}`,
      "",
    ]),
    copy.signoff.line,
    copy.signoff.signature,
    "",
    copy.footer.reason,
    `${input.sender.name} <${input.sender.address}> · ${input.sender.postalAddress}`,
    `${copy.text.unsubscribe}: ${input.unsubscribeUrl}`,
    `${copy.text.privacy}: ${input.privacyPolicyUrl}`,
    "",
  ]
    .flatMap((line) => wrap(line))
    .join("\n");
}
