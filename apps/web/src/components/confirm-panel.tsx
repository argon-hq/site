"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { confirm } from "@/actions/confirm";
import { PageHeading } from "@/components/ui/page-heading";
import { PrimaryCta } from "@/components/ui/primary-cta";

type Stage = "confirming" | "expired" | "invalid" | "error";

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
    return (
      <div role="status" className="flex flex-col gap-5">
        <PageHeading>{t("confirming.heading")}</PageHeading>
        <p className="max-w-xl text-lg text-muted text-pretty">{t("confirming.body")}</p>
      </div>
    );
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
