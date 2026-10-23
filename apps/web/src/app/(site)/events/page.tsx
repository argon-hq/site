import type { Metadata } from "next";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { eventScopes, eventsOfScope, type BusinessEvent } from "@/lib/events";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("events");

  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    // Mock (ARG-53): out of search engines until the agenda is real.
    robots: { index: false },
  };
}

/** Mono label above each heading and on the dates, as on the home. */
const KICKER = "font-mono text-xs tracking-[0.06em] text-muted uppercase";

export default function EventsPage() {
  const t = useTranslations("events");

  return (
    <div className="mx-auto w-full max-w-290 px-6">
      <section
        aria-labelledby="events-title"
        className="flex flex-col items-start gap-6 pt-[clamp(3.5rem,8vw,6rem)] pb-[clamp(2.5rem,6vw,4.5rem)]"
      >
        <p className={KICKER}>{t("kicker")}</p>
        <h1
          id="events-title"
          className="max-w-[20ch] text-[clamp(2.25rem,5.5vw,4rem)] leading-[1.02] font-medium tracking-[-0.03em] text-balance"
        >
          {t("heading")}
        </h1>
        <p className="max-w-[60ch] text-[1.1875rem] leading-normal text-muted text-pretty">{t("lead")}</p>
        <p className="max-w-[60ch] rounded-ctl border border-border bg-surface px-4 py-3 text-sm text-muted">
          {t("mockNotice")}
        </p>
      </section>

      {eventScopes.map((scope) => (
        <section
          key={scope}
          aria-labelledby={`scope-${scope}`}
          className="border-t border-border py-[clamp(2.5rem,6vw,4.5rem)]"
        >
          <h2
            id={`scope-${scope}`}
            className="mb-6 text-[clamp(1.5rem,2.6vw,2rem)] leading-[1.1] font-medium tracking-[-0.02em]"
          >
            {t(`scopes.${scope}`)}
          </h2>

          <ol className="flex flex-col">
            {eventsOfScope(scope).map((event) => (
              <EventItem key={event.id} event={event} />
            ))}
          </ol>
        </section>
      ))}

      <div className="flex flex-col items-start gap-3 border-t border-foreground py-8 sm:flex-row sm:items-baseline sm:justify-between sm:gap-8">
        <p className="max-w-[60ch] text-pretty">{t("notifyText")}</p>
        <Link
          href="/#newsletter"
          className="shrink-0 rounded-ctl font-medium underline underline-offset-4 transition hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {t("notifyCta")}
        </Link>
      </div>
    </div>
  );
}

function EventItem({ event }: { event: BusinessEvent }) {
  const t = useTranslations("events");
  const format = useFormatter();

  // The days are calendar days: read them as UTC so no time zone moves them.
  const dates = format.dateTimeRange(new Date(event.start), new Date(event.end), {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });

  return (
    <li className="grid gap-x-8 gap-y-2 border-t border-border py-6 first:border-t-0 first:pt-0 min-[860px]:grid-cols-[13rem_minmax(0,1fr)]">
      <p className={`${KICKER} min-[860px]:pt-1.5`}>{dates}</p>

      <div className="flex flex-col gap-2">
        <h3 className="text-xl leading-snug font-semibold tracking-[-0.01em] text-balance">
          <a
            href={event.url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-ctl underline decoration-border underline-offset-4 transition hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {event.name}
            <span aria-hidden="true"> ↗</span>
            <span className="sr-only"> ({t("opensInNewTab")})</span>
          </a>
        </h3>

        <p className={KICKER}>
          {[t(`items.${event.id}.city`), event.venue].filter(Boolean).join(" · ")}
          {event.free && <span className="ml-3 text-foreground">{t("free")}</span>}
        </p>

        <p className="max-w-[60ch] text-muted text-pretty">{t(`items.${event.id}.description`)}</p>
      </div>
    </li>
  );
}
