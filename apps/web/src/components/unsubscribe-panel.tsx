"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { subscribe } from "@/actions/subscribe";
import { unsubscribe } from "@/actions/unsubscribe";
import { PageHeading } from "@/components/ui/page-heading";

type Stage = "confirm" | "cancelling" | "cancelled" | "already" | "reactivating" | "reactivated";

export function UnsubscribePanel({
  token,
  email,
  cancelled,
}: {
  token: string;
  email: string;
  cancelled: boolean;
}) {
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
          {t.rich("body", { email, strong: (chunks) => <strong className="font-semibold text-foreground">{chunks}</strong> })}
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
          {/* O cancelamento é um POST, disparado por este clique. Abrir a página não cancela nada. */}
          <button
            type="button"
            onClick={handleUnsubscribe}
            disabled={stage === "cancelling"}
            className="rounded-lg bg-danger px-6 py-3.5 text-base font-semibold text-white transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger disabled:cursor-not-allowed disabled:opacity-60"
          >
            {stage === "cancelling" ? t("cancelling") : t("confirm")}
          </button>

          <Link
            href="/"
            className="text-base font-medium text-accent transition hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
        <p className="w-fit rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-bold tracking-[0.1em] text-muted uppercase">
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

      <div className="flex max-w-xl flex-col gap-4 rounded-xl border border-border p-6">
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
          className="w-fit rounded-lg bg-accent px-6 py-3 text-base font-semibold text-accent-foreground transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
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
