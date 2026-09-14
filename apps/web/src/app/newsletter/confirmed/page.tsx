import type { Metadata } from "next";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { BrandMark } from "@/components/brand-mark";
import { EditionPreview } from "@/components/edition-preview";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("confirmed");

  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    // Confirmação é destino de link de e-mail, não conteúdo para buscador.
    robots: { index: false, follow: false },
  };
}

export default function ConfirmedPage() {
  const t = useTranslations("confirmed");
  const preview = useTranslations("preview");

  return (
    <div className="grid min-h-svh flex-1 lg:grid-cols-[16fr_9fr]">
      <section className="flex flex-col px-6 py-12 sm:px-10 lg:px-16 lg:py-14">
        <div className="flex w-full max-w-2xl flex-1 flex-col justify-center gap-10 lg:gap-12">
          <div className="flex flex-col items-start gap-5">
            <BrandMark />
            <p className="rounded-md border border-success/50 bg-success/10 px-3 py-1.5 text-xs font-bold tracking-[0.1em] text-success uppercase">
              {t("badge")}
            </p>
          </div>

          <div className="flex flex-col gap-5">
            <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl">
              {t("heading")}
            </h1>
            <p className="max-w-xl text-lg text-muted text-pretty">
              {t("body")}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
            {/* TODO: a plataforma ainda não existe — o destino é placeholder. */}
            <Link
              href="/"
              className="rounded-lg bg-accent px-6 py-3.5 text-base font-semibold text-accent-foreground transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {t("primaryCta")}
            </Link>
            <Link
              href="/"
              className="text-base font-medium text-accent transition hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {t("secondaryCta")} <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>

      </section>

      <aside
        aria-label={preview("label")}
        className="hidden border-l border-border bg-surface p-10 lg:flex lg:items-center lg:justify-center"
      >
        <EditionPreview />
      </aside>
    </div>
  );
}
