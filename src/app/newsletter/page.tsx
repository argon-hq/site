import type { Metadata } from "next";
import { BrandMark } from "@/components/brand-mark";
import { NewsletterForm } from "@/components/newsletter-form";

export const metadata: Metadata = {
  title: "Newsletter",
  description:
    "Receba as últimas notícias sobre negócios no seu e-mail. Um resumo curto, sem ruído.",
};

export default function NewsletterPage() {
  return (
    <div className="grid min-h-svh flex-1 lg:grid-cols-[16fr_9fr]">
      <section className="flex items-center justify-center px-6 py-16 sm:px-10 lg:px-16">
        <div className="flex w-full max-w-2xl flex-col gap-10">
          <BrandMark />

          <div className="flex flex-col gap-3">
            <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
              Notícias de negócios, sem ruído.
            </h1>
            <p className="text-lg text-muted text-pretty">
              Um resumo curto do que importa para quem empreende, direto no seu e-mail. Leva
              menos de cinco minutos por dia.
            </p>
          </div>

          <NewsletterForm />
        </div>
      </section>

      {/* Painel visual do protótipo. Ainda sem arte definida. */}
      <aside aria-hidden="true" className="hidden border-l border-border bg-surface lg:block" />
    </div>
  );
}
