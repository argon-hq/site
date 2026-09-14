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
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
