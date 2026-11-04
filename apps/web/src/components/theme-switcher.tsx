"use client";

import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import { OptionMenu, type MenuOption } from "@/components/option-menu";
import { defaultTheme, themes, type Theme } from "@/theme/config";
import { readTheme, saveTheme, subscribeTheme } from "@/theme/store";

const ICONS: Record<Theme, () => React.ReactElement> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

/** No HTML estático, o padrão; no navegador, o que está no cookie. */
const getServerTheme = () => defaultTheme;

export function ThemeSwitcher() {
  const t = useTranslations("theme");
  // O documento já chega com o tema certo, pelo script do <head>; aqui só o ícone e o
  // item marcado acompanham o cookie, depois da hidratação.
  const current = useSyncExternalStore(subscribeTheme, readTheme, getServerTheme);

  const options: MenuOption<Theme>[] = themes.map((value) => {
    const Icon = ICONS[value];
    return { value, label: t(value), icon: <Icon /> };
  });

  const TriggerIcon = ICONS[current];

  return (
    <OptionMenu
      label={t("label")}
      triggerIcon={<TriggerIcon />}
      value={current}
      valueLabel={t(current)}
      options={options}
      onSelect={saveTheme}
    />
  );
}

function Sun() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
        <circle cx="8" cy="8" r="3.1" />
        <path d="M8 1.2v1.6M8 13.2v1.6M1.2 8h1.6M13.2 8h1.6M3.2 3.2l1.1 1.1M11.7 11.7l1.1 1.1M12.8 3.2l-1.1 1.1M4.3 11.7l-1.1 1.1" />
      </g>
    </svg>
  );
}

function Moon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        d="M13.4 9.6A5.8 5.8 0 0 1 6.4 2.6a5.9 5.9 0 1 0 7 7z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Monitor() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
        <rect x="1.6" y="2.6" width="12.8" height="8.4" rx="1.2" />
        <path d="M5.6 14h4.8M8 11v3" strokeLinecap="round" />
      </g>
    </svg>
  );
}
