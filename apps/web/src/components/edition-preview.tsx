import { useTranslations } from "next-intl";
import { BrandMark } from "@/components/brand-mark";

/**
 * Amostra de como uma edição chega no e-mail. O conteúdo é ilustrativo e vive
 * nas mensagens — não é uma edição real.
 */
const ITEMS = ["market", "productivity"] as const;

export function EditionPreview() {
  const t = useTranslations("preview");

  return (
    <div className="w-full max-w-md overflow-hidden rounded-card border border-t-2 border-border border-t-accent bg-background shadow-lg">
      <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
        <BrandMark size="sm" />
        <span className="font-mono text-xs tracking-[0.06em] text-muted uppercase">{t("label")}</span>
      </div>

      <div className="divide-y divide-border">
        {ITEMS.map((item) => (
          <article key={item} className="flex flex-col gap-1.5 px-5 py-4">
            <p className="font-mono text-[0.6875rem] tracking-[0.06em] text-muted uppercase">
              {t(`items.${item}.kicker`)}
            </p>
            <h3 className="text-sm font-semibold text-pretty">{t(`items.${item}.title`)}</h3>
            <p className="text-xs text-muted text-pretty">{t(`items.${item}.body`)}</p>
          </article>
        ))}
      </div>

      <p className="border-t border-border bg-surface px-5 py-3 text-center text-xs font-medium text-muted">
        ☕ {t("tagline")}
      </p>
    </div>
  );
}
