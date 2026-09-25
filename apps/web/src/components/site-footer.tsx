import Link from "next/link";
import { useTranslations } from "next-intl";
import { BrandMark } from "@/components/brand-mark";

/** Rodapé das telas com cabeçalho. As telas cheias não têm rodapé. */
export function SiteFooter() {
  const t = useTranslations("footer");
  const brand = useTranslations("brand");

  return (
    <footer className="mt-auto border-t border-border">
      <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-x-8 gap-y-4 px-6 py-8 text-sm text-muted">
        <span className="text-foreground">
          <BrandMark size="sm" />
        </span>
        <Link href="/privacy" className="transition hover:text-foreground">
          {t("privacy")}
        </Link>
        <span className="basis-full font-mono text-xs">
          {t("rights", {
            brand: brand("name").toUpperCase(),
            year: new Date().getFullYear(),
          })}
        </span>
      </div>
    </footer>
  );
}
