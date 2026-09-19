"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { confirm } from "@/actions/confirm";

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
        <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl">
          {t("confirming.heading")}
        </h1>
        <p className="max-w-xl text-lg text-muted text-pretty">{t("confirming.body")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl">
        {t(`${stage}.heading`)}
      </h1>
      <p className="max-w-xl text-lg text-muted text-pretty">{t(`${stage}.body`)}</p>
      <Link
        href="/newsletter"
        className="w-fit rounded-lg bg-accent px-6 py-3.5 text-base font-semibold text-accent-foreground transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {t(`${stage}.cta`)}
      </Link>
    </div>
  );
}
