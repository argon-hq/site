import Link from "next/link";
import { useTranslations } from "next-intl";

export default function HomePage() {
  const t = useTranslations();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-24">
      <h1 className="text-4xl font-bold tracking-tight">{t("brand.name")}</h1>
      <p className="max-w-prose text-lg text-muted">{t("brand.tagline")}</p>
      <Link
        href="/newsletter"
        className="w-fit rounded-lg bg-accent px-5 py-3 text-base font-semibold text-accent-foreground transition hover:opacity-90"
      >
        {t("home.cta")}
      </Link>
    </div>
  );
}
