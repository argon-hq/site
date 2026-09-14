import Link from "next/link";
import { useTranslations } from "next-intl";

/** Rodapé das telas com cabeçalho. As telas cheias não têm rodapé. */
export function SiteFooter() {
  const t = useTranslations("footer");
  const brand = useTranslations("brand");

  return (
    <footer className="mt-auto border-t border-border">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-6 py-6 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
        <span>
          {t("rights", {
            brand: brand("name").toUpperCase(),
            year: new Date().getFullYear(),
          })}
        </span>
        <Link href="/privacy" className="transition hover:text-foreground">
          {t("privacy")}
        </Link>
      </div>
    </footer>
  );
}
