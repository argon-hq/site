"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { PageHeading } from "@/components/ui/page-heading";
import { PrimaryCta } from "@/components/ui/primary-cta";
import { lookupSubscription, subscribe, unsubscribe, type Subscription } from "@/lib/subscriber";
import { tokenSchema } from "@/lib/token";

type Stage = "confirm" | "cancelling" | "cancelled" | "already" | "reactivating" | "reactivated";

/**
 * O painel com o token do link. A página é estática, então a query só existe no navegador;
 * quem usa este componente o envolve num <Suspense>, cujo fallback vai no HTML.
 */
export function UnsubscribeFromLink() {
  // `?token=a&token=b`: vale o primeiro, o do link.
  const parsed = tokenSchema.safeParse(useSearchParams().get("token"));
  const token = parsed.success ? parsed.data : null;

  // Guarda de qual token é a resposta: se a URL mudar, a anterior não vale mais.
  const [lookup, setLookup] = useState<{ token: string; subscription: Subscription | null } | null>(null);

  useEffect(() => {
    if (!token) return;
    let current = true;

    // Só consulta. O cancelamento sai no POST do botão, dentro do painel.
    lookupSubscription(token).then((subscription) => {
      if (current) setLookup({ token, subscription });
    });

    return () => {
      current = false;
    };
  }, [token]);

  // A malformed token is an invalid link right away, without a round trip.
  if (!token) return <InvalidLink />;
  if (lookup?.token !== token) return <CheckingLink />;
  if (!lookup.subscription) return <InvalidLink />;

  const { email, status } = lookup.subscription;
  return <UnsubscribePanel token={token} email={email} cancelled={status !== "confirmed" && status !== "pending"} />;
}

/** Enquanto a API responde — e, no HTML estático, enquanto o token não é lido. */
export function CheckingLink() {
  const t = useTranslations("unsubscribe.checking");

  return (
    <div role="status" className="flex flex-col gap-5">
      <PageHeading>{t("heading")}</PageHeading>
      <p className="max-w-xl text-lg text-muted text-pretty">{t("body")}</p>
    </div>
  );
}

function InvalidLink() {
  const t = useTranslations("unsubscribe.invalid");

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

export function UnsubscribePanel({ token, email, cancelled }: { token: string; email: string; cancelled: boolean }) {
  const t = useTranslations("unsubscribe");
  const [stage, setStage] = useState<Stage>(cancelled ? "already" : "confirm");
  const [error, setError] = useState<string | null>(null);

  async function handleUnsubscribe() {
    setError(null);
    setStage("cancelling");

    const result = await unsubscribe(token);

    if (!result.ok) {
      setError(t("error"));
      setStage("confirm");
      return;
    }

    setStage(result.status === "already_cancelled" ? "already" : "cancelled");
  }

  if (stage === "reactivated") {
    return <Reactivated email={email} />;
  }

  if (stage === "cancelled" || stage === "already" || stage === "reactivating") {
    return (
      <Cancelled
        email={email}
        already={stage === "already"}
        reactivating={stage === "reactivating"}
        onReactivate={setStage}
      />
    );
  }

  return (
    <div className="flex flex-col gap-10 lg:gap-12">
      <div className="flex flex-col gap-5">
        <PageHeading>{t("heading")}</PageHeading>
        <p className="max-w-xl text-lg text-muted text-pretty">
          {t.rich("body", {
            email,
            strong: (chunks) => <strong className="font-semibold text-foreground">{chunks}</strong>,
          })}
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
          {/* O cancelamento é um POST, disparado por este clique. Abrir a página não cancela nada. */}
          <button
            type="button"
            onClick={handleUnsubscribe}
            disabled={stage === "cancelling"}
            className="rounded-ctl bg-danger px-6 py-3.5 text-base font-medium text-white transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger disabled:cursor-not-allowed disabled:opacity-60"
          >
            {stage === "cancelling" ? t("cancelling") : t("confirm")}
          </button>

          <Link
            href="/"
            className="text-base font-medium underline underline-offset-4 transition hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {t("keep")} <span aria-hidden="true">→</span>
          </Link>
        </div>

        {error && (
          <p role="alert" className="text-sm font-medium text-danger">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function Cancelled({
  email,
  already,
  reactivating,
  onReactivate,
}: {
  email: string;
  already: boolean;
  reactivating: boolean;
  onReactivate: (stage: Stage) => void;
}) {
  const t = useTranslations("unsubscribe.done");
  const consentId = useId();

  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleReactivate() {
    // Reativar é um novo cadastro: sem aceite novo, não há consentimento para registrar.
    if (!consent) {
      setError(t("consentError"));
      return;
    }

    setError(null);
    onReactivate("reactivating");

    const result = await subscribe({ email, consent });

    if (!result.ok) {
      setError(t("error"));
      onReactivate("already");
      return;
    }

    onReactivate("reactivated");
  }

  return (
    <div className="flex flex-col gap-10 lg:gap-12">
      <div className="flex flex-col gap-5">
        <p className="w-fit rounded-ctl border border-border bg-surface px-3 py-1.5 font-mono text-xs font-medium tracking-[0.06em] text-muted uppercase">
          {t("badge")}
        </p>
        <PageHeading>{t("heading")}</PageHeading>
        <p className="max-w-xl text-lg text-muted text-pretty">
          {t.rich(already ? "alreadyBody" : "body", {
            email,
            strong: (chunks) => <strong className="font-semibold text-foreground">{chunks}</strong>,
          })}
        </p>
      </div>

      <div className="flex max-w-xl flex-col gap-4 rounded-card border border-border p-6">
        <p className="text-base font-semibold">{t("mistake")}</p>

        <div className="flex items-start gap-3 text-sm text-muted">
          <input
            id={consentId}
            type="checkbox"
            checked={consent}
            onChange={(event) => {
              setConsent(event.target.checked);
              if (error) setError(null);
            }}
            className="mt-0.5 size-4 shrink-0 accent-accent"
          />
          <label htmlFor={consentId}>
            {t.rich("consent", {
              link: (chunks) => (
                <Link href="/privacy" className="font-medium text-foreground underline underline-offset-2">
                  {chunks}
                </Link>
              ),
            })}
          </label>
        </div>

        <button
          type="button"
          onClick={handleReactivate}
          disabled={reactivating}
          className="w-fit rounded-ctl bg-accent px-6 py-3 text-base font-medium text-accent-foreground transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {reactivating ? t("reactivating") : t("reactivate")}
        </button>

        {error && (
          <p role="alert" className="text-sm font-medium text-danger">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function Reactivated({ email }: { email: string }) {
  const t = useTranslations("unsubscribe.reactivated");

  return (
    <div role="status" className="flex flex-col gap-5">
      <PageHeading>{t("heading")}</PageHeading>
      <p className="max-w-xl text-lg text-muted text-pretty">
        {t.rich("body", {
          email,
          strong: (chunks) => <strong className="font-semibold text-foreground">{chunks}</strong>,
        })}
      </p>
      <p className="text-sm text-muted">{t("expiry")}</p>
    </div>
  );
}
