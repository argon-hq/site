import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { BrandMark } from "@/components/brand-mark";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { getUserTheme } from "@/theme/theme";

export async function SiteHeader() {
  const t = await getTranslations();
  const theme = await getUserTheme();

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex w-full max-w-290 items-center justify-between gap-4 px-6 py-5">
        <Link
          href="/"
          className="rounded-ctl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        >
          <BrandMark size="md" />
        </Link>
        <nav className="flex items-center gap-3 sm:gap-5">
          {/* The home sections are reached from any page; on phones only the
              newsletter fits beside the switchers. */}
          <Link href="/#consultoria" className={`hidden sm:inline ${NAV_LINK}`}>
            {t("nav.consulting")}
          </Link>
          <Link href="/newsletter" className={NAV_LINK}>
            {t("nav.newsletter")}
          </Link>
          <Link href="/#eventos" className={`hidden sm:inline ${NAV_LINK}`}>
            {t("nav.events")}
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

const NAV_LINK =
  "rounded-ctl text-sm font-medium text-muted transition hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent";
