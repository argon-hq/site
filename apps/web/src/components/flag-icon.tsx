import type { ReactElement } from "react";
import type { Locale } from "@/i18n/config";

// Proporção 13 faixas na altura total da bandeira dos EUA.
const STRIPE_HEIGHT = 14 / 13;

function BrazilFlag() {
  return (
    <>
      <rect width="20" height="14" fill="#009B3A" />
      <polygon points="10,1.6 18.4,7 10,12.4 1.6,7" fill="#FEDF00" />
      <circle cx="10" cy="7" r="3.1" fill="#002776" />
    </>
  );
}

function UnitedStatesFlag() {
  return (
    <>
      <rect width="20" height="14" fill="#FFFFFF" />
      {[0, 2, 4, 6, 8, 10, 12].map((stripe) => (
        <rect key={stripe} y={stripe * STRIPE_HEIGHT} width="20" height={STRIPE_HEIGHT} fill="#B22234" />
      ))}
      <rect width="8.6" height={STRIPE_HEIGHT * 7} fill="#3C3B6E" />
    </>
  );
}

/**
 * Record<Locale, ...> de propósito: acrescentar um idioma em `locales` sem
 * desenhar a bandeira vira erro de tipo, não um buraco silencioso na UI.
 */
const FLAGS: Record<Locale, () => ReactElement> = {
  "pt-BR": BrazilFlag,
  "en-US": UnitedStatesFlag,
};

export function FlagIcon({ locale }: { locale: Locale }) {
  const Flag = FLAGS[locale];

  return (
    <svg
      viewBox="0 0 20 14"
      width="20"
      height="14"
      aria-hidden="true"
      className="shrink-0 rounded-[2px] ring-1 ring-black/15"
    >
      <Flag />
    </svg>
  );
}
