"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ENTRY_PATH_KEY } from "@/components/entry-path-tracker";

export function BackButton() {
  const t = useTranslations("common");
  const router = useRouter();

  function handleClick() {
    let entryPath: string | null = null;
    try {
      entryPath = sessionStorage.getItem(ENTRY_PATH_KEY);
    } catch {
      // Sem storage: trata como acesso direto.
    }

    // Se o visitante entrou por esta mesma rota, nao existe pagina anterior
    // dentro do site — voltar no historico sairia daqui.
    if (entryPath && entryPath !== window.location.pathname) {
      router.back();
    } else {
      router.push("/");
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm font-medium text-muted transition hover:border-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <ArrowLeft />
      <span>{t("back")}</span>
    </button>
  );
}

function ArrowLeft() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M10 3.5L5.5 8L10 12.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
