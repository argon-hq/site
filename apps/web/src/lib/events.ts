export const eventScopes = ["region", "brazil", "world"] as const;

export type EventScope = (typeof eventScopes)[number];

export type BusinessEvent = {
  /** Key of the city and description in the `events.items` messages. */
  id: string;
  scope: EventScope;
  name: string;
  /** First and last day, as YYYY-MM-DD. The dates are calendar days, with no time zone. */
  start: string;
  end: string;
  /** Left out when the organizer's page does not name one. */
  venue?: string;
  /** Set only when the organizer's page says admission is free. */
  free?: true;
  url: string;
};

/**
 * Mock of ARG-53: real events picked by hand, each one checked against the
 * organizer's own page on 2026-09-29. It stands in for the agenda until the
 * research task (ARG-54) feeds a table. Sorted by start date inside each scope.
 */
export const events: readonly BusinessEvent[] = [
  {
    id: "feira-empreendedores",
    scope: "region",
    name: "Feira de Empreendedores",
    start: "2026-10-16",
    end: "2026-10-17",
    venue: "Pinhão Hub Rebouças",
    free: true,
    url: "https://agenciacuritiba.com.br/eventos/feira-de-empreendedores/",
  },
  {
    id: "tecnopuc-experience",
    scope: "region",
    name: "Tecnopuc Experience",
    start: "2026-10-20",
    end: "2026-10-22",
    venue: "Tecnopuc",
    url: "https://tecnopuc.pucrs.br/eventos/tecnopuc-experience-2026/",
  },
  {
    id: "web-summit",
    scope: "world",
    name: "Web Summit",
    start: "2026-11-09",
    end: "2026-11-12",
    venue: "MEO Arena",
    url: "https://websummit.com/web-summit-2026/",
  },
  {
    id: "slush",
    scope: "world",
    name: "Slush",
    start: "2026-11-18",
    end: "2026-11-19",
    url: "https://slush.org/",
  },
  {
    id: "brasil-global-summit",
    scope: "brazil",
    name: "Brasil Global Summit",
    start: "2026-11-24",
    end: "2026-11-26",
    venue: "Arena Mané Garrincha",
    free: true,
    url: "https://brasilglobalsummit.com/",
  },
];

export function eventsOfScope(scope: EventScope): BusinessEvent[] {
  return events.filter((event) => event.scope === scope);
}
