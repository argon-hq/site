// Hard rules of the edition steps. The agent judges inside these limits; it never changes them,
// and they are the same in every environment — what changes with the environment is in `profile.ts`.
// The sources are not here: they live in the `source` table (src/ingest), and the triage of the
// ingestion in `src/ingest/triage.ts`.

// 24 hours; 48 on Mondays (São Paulo time) to cover the weekend.
export function windowHours(date: Date): number {
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "America/Sao_Paulo" }).format(date);
  return weekday === "Mon" ? 48 : 24;
}

export function windowStart(date: Date): Date {
  return new Date(date.getTime() - windowHours(date) * 60 * 60 * 1000);
}

// The edition's calendar day in São Paulo, in the shape the DATE column stores: midnight UTC.
export function editionDate(date: Date): Date {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(date);
  return new Date(`${day}T00:00:00Z`);
}
