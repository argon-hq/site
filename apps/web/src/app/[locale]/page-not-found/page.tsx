import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BrandMark } from "@/components/brand-mark";
import { PageHeading } from "@/components/ui/page-heading";
import { PrimaryCta } from "@/components/ui/primary-cta";
import { LOCALE_COOKIE, type Locale, defaultLocale, locales } from "@/i18n/config";

/**
 * A página de erro do CloudFront: um endereço que não existe em nenhuma pasta de idioma recebe
 * 404 com o corpo de /pt-BR/page-not-found/ (deploy/aws/site_cdn.tf). A resposta de erro não passa
 * pela função que escolhe a pasta pelo cookie, então a mesma página serve todo mundo: ela leva o
 * texto de cada idioma, e o script abaixo, que roda antes do conteúdo ser desenhado, marca no
 * <html> o idioma do cookie. Sem script, ou sem cookie, fica o idioma padrão.
 */
const localeScript = `(function () {
  try {
    var match = document.cookie.match(/(?:^|;\\s*)${LOCALE_COOKIE}=([^;]*)/);
    var locale = match ? decodeURIComponent(match[1]) : "";
    if (${JSON.stringify(locales)}.indexOf(locale) === -1) locale = ${JSON.stringify(defaultLocale)};
    document.documentElement.setAttribute("data-locale", locale);
    document.documentElement.lang = locale;
  } catch (error) {}
})();`;

// Qual cópia aparece para cada idioma marcado no <html>. Sem marca, a do padrão.
const VISIBILITY: Record<Locale, string> = {
  "pt-BR": "flex in-data-[locale=en-US]:hidden",
  "en-US": "hidden in-data-[locale=en-US]:flex",
};

// O título não segue o cookie (o Next o reescreve ao hidratar), então é o que vale nos dois idiomas.
export const metadata: Metadata = {
  title: "404",
  robots: { index: false, follow: false },
};

export default async function PageNotFound() {
  const copies = await Promise.all(
    locales.map(async (locale) => ({ locale, t: await getTranslations({ locale, namespace: "notFound" }) })),
  );

  return (
    <div className="flex min-h-svh flex-1 flex-col">
      <script dangerouslySetInnerHTML={{ __html: localeScript }} />
      <main id="main-content" className="flex flex-1 flex-col px-6 py-12 sm:px-10 lg:px-16 lg:py-14">
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-10 lg:gap-12">
          <BrandMark />

          {copies.map(({ locale, t }) => (
            <div key={locale} lang={locale} className={`flex-col gap-10 lg:gap-12 ${VISIBILITY[locale]}`}>
              <div className="flex flex-col items-start gap-5">
                <p className="rounded-ctl border border-border px-3 py-1.5 font-mono text-xs font-medium tracking-[0.06em] text-muted uppercase">
                  {t("badge")}
                </p>
                <PageHeading>{t("heading")}</PageHeading>
                <p className="max-w-xl text-lg text-muted text-pretty">{t("body")}</p>
              </div>

              <PrimaryCta href="/" className="w-fit">
                {t("cta")}
              </PrimaryCta>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
