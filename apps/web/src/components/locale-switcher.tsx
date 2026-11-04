"use client";

import { useLocale, useTranslations } from "next-intl";
import { FlagIcon } from "@/components/flag-icon";
import { OptionMenu, type MenuOption } from "@/components/option-menu";
import { LOCALE_COOKIE, isLocale, locales, type Locale } from "@/i18n/config";
import { writeCookie } from "@/lib/cookie";

/**
 * O idioma vive em cookie, não no link: as URLs do site não têm prefixo, e o CloudFront
 * escolhe a pasta do idioma (/pt-BR/, /en-US/) pelo cookie. Selecionar grava o cookie e
 * recarrega a página, que volta no novo idioma.
 */
export function LocaleSwitcher() {
  const t = useTranslations("localeSwitcher");
  const activeLocale = useLocale();
  const current: Locale = isLocale(activeLocale) ? activeLocale : locales[0];

  const options: MenuOption<Locale>[] = locales.map((locale) => ({
    value: locale,
    label: t(locale),
    icon: <FlagIcon locale={locale} />,
  }));

  return (
    <OptionMenu
      label={t("label")}
      triggerIcon={<Globe />}
      value={current}
      valueLabel={t(current)}
      options={options}
      onSelect={(locale) => {
        writeCookie(LOCALE_COOKIE, locale);
        switchLocation(window.location);
      }}
    />
  );
}

/**
 * Recarrega no idioma do cookie. Quem chegou por uma URL com prefixo (/en-US/...) iria parar
 * no mesmo idioma de novo: o prefixo sai, e a borda decide pelo cookie.
 */
export function switchLocation(location: Pick<Location, "pathname" | "search" | "hash" | "assign" | "reload">) {
  const [, first, ...rest] = location.pathname.split("/");

  if (isLocale(first)) {
    location.assign(`/${rest.join("/")}${location.search}${location.hash}`);
  } else {
    location.reload();
  }
}

function Globe() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
        <circle cx="8" cy="8" r="6.25" />
        <ellipse cx="8" cy="8" rx="2.6" ry="6.25" />
        <path d="M2.1 6H13.9M2.1 10H13.9" />
      </g>
    </svg>
  );
}
