// Plain-text rules shared by every template: the 78-column limit (RFC 5322). Lines with a URL are
// never wrapped, because a broken URL is a broken link.
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
