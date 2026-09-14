import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { BackButton } from "@/components/back-button";
import { BrandMark } from "@/components/brand-mark";
import { NewsletterForm } from "@/components/newsletter-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("newsletter");

  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
  };
}

export default function NewsletterPage() {
  const t = useTranslations("newsletter");

  return (
    <div className="relative grid min-h-svh flex-1 lg:grid-cols-[16fr_9fr]">
      {/* Esta tela nao tem header: o botao de voltar fica no canto da pagina.
          O seletor de idioma vive apenas nas telas com cabecalho. */}
      <div className="absolute left-6 top-6 z-30">
        <BackButton />
      </div>

      <section className="flex items-center justify-center px-6 py-16 sm:px-10 lg:px-16">
        <div className="flex w-full max-w-2xl flex-col gap-10">
          <BrandMark />

          <div className="flex flex-col gap-3">
            <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
              {t("heading")}
            </h1>
            <p className="text-lg text-muted text-pretty">{t("subheading")}</p>
          </div>

          <NewsletterForm />
        </div>
      </section>

      {/* Painel visual do protótipo. Ainda sem arte definida. */}
      <aside aria-hidden="true" className="hidden border-l border-border bg-surface lg:block" />
    </div>
  );
}
