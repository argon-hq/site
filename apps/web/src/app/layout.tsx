import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { EntryPathTracker } from "@/components/entry-path-tracker";
import { getUserTheme } from "@/theme/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("brand");

  return {
    title: {
      default: t("name"),
      template: `%s | ${t("name")}`,
    },
    description: t("tagline"),
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  const theme = await getUserTheme();
  const t = await getTranslations("common");

  return (
    <html
      lang={locale}
      // Ausente quando o tema e "system": ai o color-scheme segue o SO.
      data-theme={theme === "system" ? undefined : theme}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <NextIntlClientProvider>
          <EntryPathTracker />
          {/* Skip link: hidden until it receives keyboard focus. Every page
              marks its landmark with id="main-content". */}
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {t("skipToContent")}
          </a>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
