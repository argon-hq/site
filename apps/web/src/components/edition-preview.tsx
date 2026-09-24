import { useTranslations } from "next-intl";

/**
 * Amostra de como uma edição chega no e-mail. O conteúdo é ilustrativo e vive
 * nas mensagens — não é uma edição real.
 */
const ITEMS = ["market", "productivity"] as const;

export function EditionPreview() {
  const t = useTranslations("preview");
  const brand = useTranslations("brand");

  return (
    <div className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-background shadow-lg">
      <div className="flex items-baseline justify-between gap-4 bg-foreground px-5 py-4 text-background">
        <span className="text-sm font-bold tracking-[0.18em]">{brand("name").toUpperCase()}</span>
        <span className="text-xs opacity-70">{t("label")}</span>
      </div>

      <div className="divide-y divide-border">
        {ITEMS.map((item) => (
          <article key={item} className="flex flex-col gap-1.5 px-5 py-4">
            <p className="text-[0.6875rem] font-semibold tracking-[0.12em] text-muted uppercase">
              {t(`items.${item}.kicker`)}
            </p>
            <h3 className="text-sm font-bold text-pretty">{t(`items.${item}.title`)}</h3>
            <p className="text-xs text-muted text-pretty">{t(`items.${item}.body`)}</p>
          </article>
        ))}
      </div>

      <p className="bg-surface px-5 py-3 text-center text-xs font-medium text-muted">☕ {t("tagline")}</p>
    </div>
  );
}
