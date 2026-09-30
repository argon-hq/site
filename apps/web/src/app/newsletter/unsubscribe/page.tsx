import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BrandMark } from "@/components/brand-mark";
import { EditionPreview } from "@/components/edition-preview";
import { PageHeading } from "@/components/ui/page-heading";
import { PrimaryCta } from "@/components/ui/primary-cta";
import { UnsubscribePanel } from "@/components/unsubscribe-panel";
import { lookupSubscription, type SubscriptionLookup } from "@/lib/subscription";
import { firstParam, tokenSchema } from "@/lib/token";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("unsubscribe");

  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    // Destino de link de e-mail, e com token na URL: fora do índice dos buscadores.
    robots: { index: false, follow: false },
  };
}

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const params = await searchParams;
  // A malformed token is an invalid link right away, without a round trip.
  const token = tokenSchema.safeParse(firstParam(params.token));
  const preview = await getTranslations("preview");

  // Só consulta. O cancelamento sai no POST do botão, dentro do painel.
  const lookup: SubscriptionLookup = token.success ? await lookupSubscription(token.data) : { kind: "invalid" };

  return (
    <div className="grid min-h-svh flex-1 lg:grid-cols-[16fr_9fr]">
      <main id="main-content" className="flex flex-col px-6 py-12 sm:px-10 lg:px-16 lg:py-14">
        <div className="flex w-full max-w-2xl flex-1 flex-col justify-center gap-10 lg:gap-12">
          <BrandMark />

          {!token.success || lookup.kind === "invalid" ? (
            <InvalidLink />
          ) : lookup.kind === "unavailable" ? (
            <Unavailable token={token.data} />
          ) : (
            <UnsubscribePanel
              token={token.data}
              email={lookup.subscription.email}
              status={lookup.subscription.status}
            />
          )}
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

async function InvalidLink() {
  const t = await getTranslations("unsubscribe.invalid");

  return (
    <div className="flex flex-col gap-5">
      <PageHeading>{t("heading")}</PageHeading>
      <p className="max-w-xl text-lg text-muted text-pretty">{t("body")}</p>
      <PrimaryCta href="/" className="w-fit">
        {t("cta")}
      </PrimaryCta>
    </div>
  );
}

// A API não respondeu: o link continua valendo, e tentar de novo é abrir a mesma página.
async function Unavailable({ token }: { token: string }) {
  const t = await getTranslations("unsubscribe.unavailable");

  return (
    <div className="flex flex-col gap-5">
      <PageHeading>{t("heading")}</PageHeading>
      <p className="max-w-xl text-lg text-muted text-pretty">{t("body")}</p>
      <PrimaryCta href={`/newsletter/unsubscribe?token=${encodeURIComponent(token)}`} className="w-fit">
        {t("cta")}
      </PrimaryCta>
    </div>
  );
}
