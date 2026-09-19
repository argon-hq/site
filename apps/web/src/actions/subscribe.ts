"use server";

import { headers } from "next/headers";
import { apiFetch } from "@/lib/api";
import { isValidEmail, normalizeEmail } from "@/lib/email";

type SubscribeResult = { ok: boolean };

/**
 * Grava o e-mail na base, pela API. A chamada acontece no servidor: o segredo
 * interno nunca chega ao navegador.
 *
 * O retorno é sempre o mesmo para endereço novo, pendente ou já confirmado — a
 * tela não revela quem está cadastrado.
 */
export async function subscribe(input: { email: string; consent: boolean }): Promise<SubscribeResult> {
  // A action é um endpoint público: a validação do formulário não vale como garantia.
  if (!isValidEmail(input.email) || !input.consent) return { ok: false };

  const requestHeaders = await headers();

  const result = await apiFetch<{ status: string }>("/subscriber", {
    method: "POST",
    body: {
      email: normalizeEmail(input.email),
      // Prova de opt-in exigida pela LGPD. Atrás do Caddy o IP real é o primeiro da lista.
      consentIp: requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim(),
      consentUserAgent: requestHeaders.get("user-agent") ?? undefined,
    },
  });

  return { ok: result.ok };
}
