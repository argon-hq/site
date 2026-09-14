import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("privacy");
  return { title: t("metaTitle") };
}

// Placeholder: o texto legal ainda será redigido pelo time. A página existe
// para que o aceite no cadastro (REB-38) tenha um destino válido.
export default function PrivacyPage() {
  const t = useTranslations("privacy");

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-20">
      <h1 className="text-3xl font-bold tracking-tight">{t("heading")}</h1>
      <p className="text-muted">{t("body")}</p>
    </div>
  );
}
