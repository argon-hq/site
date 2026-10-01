// Dates as the feeds write them: RFC 822 in RSS (`Tue, 29 Sep 2026 19:32:00 -0300`, with or
// without the weekday), ISO 8601 in Atom and in news sitemaps (with microseconds at Valor), and ISO
// without any offset at Exame. A date without an offset is read as São Paulo time: the sources are
// Brazilian and publish in the local clock. Brazil has had no daylight saving since 2019, so the
// offset is fixed.
const SAO_PAULO_OFFSET = "-03:00";
const SAO_PAULO_OFFSET_RFC = "-0300";

const ISO = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2})?)(?:\.(\d+))?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;
// Only what looks like RFC 822 is handed to V8, which turns almost any text into some date.
const RFC = /^(?:[a-z]{3},?\s+)?\d{1,2}\s+[a-z]{3}\s+\d{2,4}\s+\d{1,2}:\d{2}/i;
const RFC_ZONE = /(?:[+-]\d{4}|\b(?:GMT|UTC|UT|Z|[ECMP][SD]T))$/i;

export function parseFeedDate(raw: string | undefined | null): Date | null {
  const text = raw?.trim();
  if (!text) return null;

  const iso = ISO.exec(text);
  if (iso) {
    const [, day, time = "00:00:00", fraction, zone] = iso;
    const seconds = time.length === 5 ? `${time}:00` : time;
    // Milliseconds only: `Date` reads three digits, and Valor writes six.
    const millis = fraction ? `.${fraction.slice(0, 3).padEnd(3, "0")}` : "";
    return valid(new Date(`${day}T${seconds}${millis}${isoOffset(zone)}`));
  }

  // RFC 822 and its variations: V8 reads them, weekday or not, and `-0000` as UTC. Without a zone
  // V8 would read the machine's clock, so the São Paulo offset is written in first.
  if (!RFC.test(text)) return null;
  return valid(new Date(RFC_ZONE.test(text) ? text : `${text} ${SAO_PAULO_OFFSET_RFC}`));
}

// The zone in the form `Date` reads: `Z`, or `±HH:MM` — `-0300` gains its colon, none is São Paulo.
function isoOffset(zone: string | undefined): string {
  if (!zone) return SAO_PAULO_OFFSET;
  if (zone.toUpperCase() === "Z") return "Z";
  return zone.includes(":") ? zone : `${zone.slice(0, 3)}:${zone.slice(3)}`;
}

function valid(date: Date): Date | null {
  return Number.isNaN(date.getTime()) ? null : date;
}
