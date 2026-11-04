import type { Metadata } from "next";
import { Geist_Mono, Manrope } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { EntryPathTracker } from "@/components/entry-path-tracker";
import { locales } from "@/i18n/config";
import { siteOrigin } from "@/lib/site";
import { defaultTheme } from "@/theme/config";
import { themeScript } from "@/theme/script";
import "../globals.css";

// Manrope for headings and text, Geist Mono for labels, dates and edition
// numbers. Both are variable fonts, so every weight comes in one file.
const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Uma cópia do site por idioma, gerada no build: /pt-BR/... e /en-US/.... Os links internos
 * não levam prefixo; quem escolhe a pasta é a CDN, pelo cookie de idioma.
 */
export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

// Idioma fora da lista é 404, não uma página gerada na hora: não há servidor para gerá-la.
export const dynamicParams = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("brand");
  const locale = await getLocale();

  return {
    // Base of every relative URL in the metadata, the Open Graph image included.
    metadataBase: new URL(siteOrigin()),
    title: {
      default: t("name"),
      template: `%s | ${t("name")}`,
    },
    description: t("tagline"),
    openGraph: {
      title: t("name"),
      description: t("tagline"),
      siteName: t("name"),
      // Open Graph spells locales with an underscore.
      locale: locale.replace("-", "_"),
      type: "website",
    },
    twitter: { card: "summary_large_image" },
  };
}

export default async function RootLayout({ children }: LayoutProps<"/[locale]">) {
  const locale = await getLocale();
  const t = await getTranslations("common");

  return (
    <html
      lang={locale}
      // O HTML estático sai com o tema padrão; o script abaixo troca pelo do cookie antes da
      // pintura. Ausente quando o tema e "system": ai o color-scheme segue o SO. O aviso de
      // hidratação é suprimido porque o atributo muda, de propósito, antes do React chegar.
      data-theme={defaultTheme === "system" ? undefined : defaultTheme}
      suppressHydrationWarning
      className={`${manrope.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-full flex-col">
        <NextIntlClientProvider>
          <EntryPathTracker />
          {/* Skip link: hidden until it receives keyboard focus. Every page
              marks its landmark with id="main-content". */}
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-ctl focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {t("skipToContent")}
          </a>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
