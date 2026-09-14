"use client";

import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { FlagIcon } from "@/components/flag-icon";
import { OptionMenu, type MenuOption } from "@/components/option-menu";
import { isLocale, locales, type Locale } from "@/i18n/config";
import { setUserLocale } from "@/i18n/locale";

/**
 * O idioma vive em cookie, não na URL. Selecionar dispara a server action e o
 * Next re-renderiza a rota atual com as mensagens do novo idioma.
 */
export function LocaleSwitcher() {
  const t = useTranslations("localeSwitcher");
  const activeLocale = useLocale();
  const current: Locale = isLocale(activeLocale) ? activeLocale : locales[0];
  const [isPending, startTransition] = useTransition();

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
      disabled={isPending}
      onSelect={(locale) =>
        startTransition(() => {
          setUserLocale(locale);
        })
      }
    />
  );
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
