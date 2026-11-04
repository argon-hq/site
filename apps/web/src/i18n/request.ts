import { locale as rootLocale } from "next/root-params";
import { getRequestConfig } from "next-intl/server";
import { defaultLocale, isLocale } from "./config";

/**
 * O idioma vem do segmento [locale] da rota, lido no build: cada página é gerada uma vez por
 * idioma, sem cookie nem header de requisição (o site é estático).
 */
export default getRequestConfig(async ({ locale: override }) => {
  // `getTranslations({ locale })` explícito vence o segmento.
  const segment = override ?? (await rootLocale());
  const locale = isLocale(segment) ? segment : defaultLocale;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
