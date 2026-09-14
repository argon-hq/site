import { useTranslations } from "next-intl";

/**
 * Placeholder do logo: a Argon ainda não tem identidade visual definida.
 * Ocupa o quadrado que o protótipo reserva para a marca.
 */
export function BrandMark() {
  const t = useTranslations("brand");
  const name = t("name");

  return (
    <div
      role="img"
      aria-label={name}
      className="flex size-24 items-center justify-center rounded-xl bg-foreground text-3xl font-bold tracking-tight text-background select-none sm:size-32 sm:text-4xl"
    >
      {name.charAt(0)}
    </div>
  );
}
