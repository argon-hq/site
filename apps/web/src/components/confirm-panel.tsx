"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { confirm } from "@/lib/subscriber";
import { PageHeading } from "@/components/ui/page-heading";
import { PrimaryCta } from "@/components/ui/primary-cta";
import { tokenSchema } from "@/lib/token";

type Stage = "confirming" | "expired" | "invalid" | "error";

/**
 * O painel com o token do link. A página é estática, então a query só existe no navegador;
 * quem usa este componente o envolve num <Suspense>, cujo fallback vai no HTML.
 */
export function ConfirmFromLink() {
  // `?token=a&token=b`: vale o primeiro, o do link.
  const token = tokenSchema.safeParse(useSearchParams().get("token"));
  // A malformed token shows the invalid state right away, without a round trip.
  return <ConfirmPanel token={token.success ? token.data : null} />;
}

export function ConfirmPanel({ token }: { token: string | null }) {
  const t = useTranslations("confirm");
  const router = useRouter();

  const [stage, setStage] = useState<Stage>(token ? "confirming" : "invalid");
  // React roda o efeito duas vezes em desenvolvimento; confirmar é idempotente, mas
  // não há motivo para bater duas vezes na API.
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;

    // No mount, não num link: o scanner do cliente de e-mail abre a página, mas não
    // executa JavaScript, então quem confirma é sempre uma pessoa com o navegador aberto.
    confirm(token).then((result) => {
      if (result.ok) router.replace("/newsletter/confirmed");
      else setStage(result.reason);
    });
  }, [token, router]);

  if (stage === "confirming") {
    return <Confirming />;
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeading>{t(`${stage}.heading`)}</PageHeading>
      <p className="max-w-xl text-lg text-muted text-pretty">{t(`${stage}.body`)}</p>
      <PrimaryCta href="/newsletter" className="w-fit">
        {t(`${stage}.cta`)}
      </PrimaryCta>
    </div>
  );
}

/** Enquanto a API responde — e, no HTML estático, enquanto o token não é lido. */
export function Confirming() {
  const t = useTranslations("confirm.confirming");

  return (
    <div role="status" className="flex flex-col gap-5">
      <PageHeading>{t("heading")}</PageHeading>
      <p className="max-w-xl text-lg text-muted text-pretty">{t("body")}</p>
    </div>
  );
}
