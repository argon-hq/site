import { copy } from "../copy";
import { formatDate } from "../html";
import type { EditionInput } from "../types";

// 78-column limit (RFC 5322). Lines with a URL are never wrapped.
export const TEXT_WIDTH = 78;

export function wrap(line: string, width = TEXT_WIDTH): string[] {
  if (line.length <= width || /https?:\/\//.test(line)) return [line];
  const words = line.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current && `${current} ${word}`.length > width) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

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
