"use server";

import { headers } from "next/headers";
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

  const apiUrl = process.env.API_URL;
  const secret = process.env.INTERNAL_API_SECRET;
  if (!apiUrl || !secret) {
    console.error({ msg: "subscribe: API_URL ou INTERNAL_API_SECRET ausente" });
    return { ok: false };
  }

  const requestHeaders = await headers();

  try {
    const response = await fetch(`${apiUrl}/subscriber`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-secret": secret },
      body: JSON.stringify({
        email: normalizeEmail(input.email),
        // Prova de opt-in exigida pela LGPD. Atrás do Caddy o IP real é o primeiro da lista.
        consentIp: requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim(),
        consentUserAgent: requestHeaders.get("user-agent") ?? undefined,
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      console.error({ msg: "subscribe: API recusou o cadastro", status: response.status });
      return { ok: false };
    }

    return { ok: true };
  } catch (error) {
    console.error({ msg: "subscribe: API inacessível", error: String(error) });
    return { ok: false };
  }
}
