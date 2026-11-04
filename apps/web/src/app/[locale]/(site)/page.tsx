import type { Metadata } from "next";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { EditionCard } from "@/components/edition-card";
import { NewsletterForm } from "@/components/newsletter-form";
import { PrimaryCta } from "@/components/ui/primary-cta";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("home");

  return {
    // The home carries the essence, not the "%s | Argon" template.
    title: { absolute: t("metaTitle") },
    description: t("metaDescription"),
  };
}

const FACTS = ["frequency", "arrival", "reading"] as const;
const STEPS = ["analysis", "strategy", "execution"] as const;

/** Mono label above each heading and on the facts, as in the prototype. */
const KICKER = "font-mono text-xs tracking-[0.06em] text-muted uppercase";
const H2 = "text-[clamp(1.75rem,3.2vw,2.5rem)] leading-[1.1] font-medium tracking-[-0.025em] text-balance";
const SECTION = "flex flex-col items-start gap-9 border-t border-border py-[clamp(3.5rem,8vw,6.5rem)]";

export default function HomePage() {
  const t = useTranslations("home");
  const newsletter = useTranslations("newsletter");

  return (
    <div className="mx-auto w-full max-w-290 px-6">
      <section
        aria-labelledby="hero-title"
        className="grid items-end gap-[clamp(2.5rem,6vw,6rem)] pt-[clamp(3.5rem,10vw,8rem)] pb-[clamp(3.5rem,8vw,6rem)] min-[860px]:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]"
      >
        <div className="flex flex-col gap-6">
          <p className={KICKER}>{t("hero.kicker")}</p>
          <h1
            id="hero-title"
            className="text-[clamp(2.75rem,7vw,5.5rem)] leading-[0.98] font-medium tracking-[-0.035em] text-balance"
          >
            {t("hero.heading")}
          </h1>
          <p className="max-w-[60ch] text-[1.1875rem] leading-normal text-muted text-pretty">{t("hero.lead")}</p>
          <div className="mt-2 flex flex-wrap gap-3">
            <PrimaryCta href="#newsletter">{t("hero.primaryCta")}</PrimaryCta>
            <Link
              href="#consultoria"
              className="rounded-ctl border border-foreground px-6 py-[13px] text-base font-medium transition hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {t("hero.secondaryCta")}
            </Link>
          </div>
        </div>

        <EditionCard />
      </section>

      <section id="newsletter" aria-labelledby="newsletter-title" className={SECTION}>
        <SectionHead kicker={t("newsletter.kicker")} titleId="newsletter-title" title={newsletter("heading")}>
          {newsletter("subheading")}
        </SectionHead>

        <div className="w-full max-w-160">
          <NewsletterForm />
        </div>

        <dl className="grid w-full max-w-160 gap-2 border-t border-border sm:grid-cols-3 sm:gap-0">
          {FACTS.map((fact) => (
            <div key={fact} className="flex flex-col gap-1 pt-3.5">
              <dt className={KICKER}>{t(`newsletter.facts.${fact}.label`)}</dt>
              <dd className="font-medium">{t(`newsletter.facts.${fact}.value`)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section id="consultoria" aria-labelledby="consulting-title" className={SECTION}>
        <SectionHead kicker={t("consulting.kicker")} titleId="consulting-title" title={t("consulting.heading")} />

        <ol className="grid w-full gap-4 min-[860px]:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step} className="flex flex-col gap-2.5 rounded-card border border-border px-6 pt-6 pb-7">
              <span className="font-mono text-sm tracking-[0.06em]">{index + 1}</span>
              <h3 className="text-lg leading-snug font-semibold tracking-[-0.01em]">
                {t(`consulting.steps.${step}.title`)}
              </h3>
              <p className="text-muted text-pretty">{t(`consulting.steps.${step}.body`)}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="eventos" aria-labelledby="events-title" className={SECTION}>
        <SectionHead kicker={t("events.kicker")} titleId="events-title" title={t("events.heading")}>
          {t("events.body")}
        </SectionHead>

        {/* No real events yet: the prototype's examples stay out of the site. */}
        <div className="flex w-full flex-col items-start gap-4 border-t border-foreground pt-5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-8">
          <p className="max-w-[60ch] text-pretty">{t("events.comingSoon")}</p>
          <Link
            href="#newsletter"
            className="shrink-0 rounded-ctl font-medium underline underline-offset-4 transition hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {t("events.notifyCta")}
          </Link>
        </div>
      </section>
    </div>
  );
}

type SectionHeadProps = {
  kicker: string;
  titleId: string;
  title: string;
  children?: ReactNode;
};

function SectionHead({ kicker, titleId, title, children }: SectionHeadProps) {
  return (
    <div className="flex max-w-[62ch] flex-col gap-3.5">
      <p className={KICKER}>{kicker}</p>
      <h2 id={titleId} className={H2}>
        {title}
      </h2>
      {children && <p className="max-w-[60ch] text-muted text-pretty">{children}</p>}
    </div>
  );
}
