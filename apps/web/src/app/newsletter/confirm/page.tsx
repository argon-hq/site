import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BrandMark } from "@/components/brand-mark";
import { ConfirmPanel } from "@/components/confirm-panel";
import { EditionPreview } from "@/components/edition-preview";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("confirm");

  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    // Destino de link de e-mail, e com token na URL: fora do índice dos buscadores.
    robots: { index: false, follow: false },
  };
}

export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const preview = await getTranslations("preview");

  return (
    <div className="grid min-h-svh flex-1 lg:grid-cols-[16fr_9fr]">
      <main id="main-content" className="flex flex-col px-6 py-12 sm:px-10 lg:px-16 lg:py-14">
        <div className="flex w-full max-w-2xl flex-1 flex-col justify-center gap-10 lg:gap-12">
          <BrandMark />
          <ConfirmPanel token={token ?? null} />
        </div>
      </main>

      <aside
        aria-label={preview("label")}
        className="hidden border-l border-border bg-surface p-10 lg:flex lg:items-center lg:justify-center"
      >
        <EditionPreview />
      </aside>
    </div>
  );
}
