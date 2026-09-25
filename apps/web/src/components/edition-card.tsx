import { useTranslations } from "next-intl";

/**
 * The edition sample of the home hero, as the prototype draws it: accent top
 * rule, mono header and footer. The items reuse the illustrative content of
 * EditionPreview; it is not a real edition and nothing is fetched.
 */
export function EditionCard() {
  const t = useTranslations("home.edition");
  const preview = useTranslations("preview");

  return (
    <article
      aria-label={preview("label")}
      className="w-full overflow-hidden rounded-card border-t-2 border-accent bg-surface"
    >
      <header className="flex flex-col gap-0.5 border-b border-border px-6 py-4 sm:flex-row sm:justify-between sm:gap-3">
        <span className={LABEL}>{t("number")}</span>
        <span className={LABEL}>{t("date")}</span>
      </header>

      <div className="flex flex-col gap-2 border-b border-border px-6 py-5">
        <p className={LABEL}>{preview("items.market.kicker")}</p>
        <h2 className={TITLE}>{preview("items.market.title")}</h2>
        <p className="text-muted text-pretty">{preview("items.market.body")}</p>
      </div>

      <div className="flex flex-col gap-2 border-b border-border px-6 py-5">
        <p className={LABEL}>{preview("items.productivity.kicker")}</p>
        <h2 className={TITLE}>{preview("items.productivity.title")}</h2>
      </div>

      <footer className={`px-6 py-3.5 ${LABEL}`}>{t("readingTime")}</footer>
    </article>
  );
}

const LABEL = "font-mono text-xs tracking-[0.06em] text-muted uppercase";
const TITLE = "text-lg leading-snug font-semibold tracking-[-0.01em] text-balance";
