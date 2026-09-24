import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { BackButton } from "@/components/back-button";
import { BrandMark } from "@/components/brand-mark";
import { EditionPreview } from "@/components/edition-preview";
import { NewsletterForm } from "@/components/newsletter-form";
import { PageHeading } from "@/components/ui/page-heading";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("newsletter");

  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
  };
}

export default function NewsletterPage() {
  const t = useTranslations("newsletter");
  const preview = useTranslations("preview");

  return (
    <div className="relative grid min-h-svh flex-1 lg:grid-cols-[16fr_9fr]">
      {/* Esta tela nao tem header: o botao de voltar fica no canto da pagina.
          O seletor de idioma vive apenas nas telas com cabecalho. */}
      <div className="absolute left-6 top-6 z-30">
        <BackButton />
      </div>

      <main id="main-content" className="flex flex-col px-6 py-12 sm:px-10 lg:px-16 lg:py-14">
        <div className="flex w-full max-w-2xl flex-1 flex-col justify-center gap-10 lg:gap-12">
          <BrandMark />

          <div className="flex flex-col gap-3">
            <PageHeading>{t("heading")}</PageHeading>
            <p className="max-w-xl text-lg text-muted text-pretty">{t("subheading")}</p>
          </div>

          <NewsletterForm />
        </div>

      </main>

      {/* Provisório: mostra a mesma amostra de edição da tela de confirmação,
          até existir arte própria para este painel. */}
      <aside
        aria-label={preview("label")}
        className="hidden border-l border-border bg-surface p-10 lg:flex lg:items-center lg:justify-center"
      >
        <EditionPreview />
      </aside>
    </div>
  );
}
