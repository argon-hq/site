import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { getUserTheme } from "@/theme/theme";

export async function SiteHeader() {
  const t = await getTranslations();
  const theme = await getUserTheme();

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-5">
        <Link href="/" className="text-lg font-bold tracking-tight">
          {t("brand.name")}
        </Link>
        <nav className="flex items-center gap-3">
          <Link
            href="/newsletter"
            className="text-sm font-medium text-muted transition hover:text-foreground"
          >
            {t("nav.newsletter")}
          </Link>
          <div className="flex items-center gap-2">
            <ThemeSwitcher theme={theme} />
            <LocaleSwitcher />
          </div>
        </nav>
      </div>
    </header>
  );
}
