"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { apiFetch } from "@/lib/api";

// The action is a public endpoint: the form's own validation is no guarantee.
// Trim and lowercase first, then check the shape, as the API expects it.
const subscribeInput = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  consent: z.literal(true),
});

type SubscribeResult = { ok: boolean };

/**
 * Grava o e-mail na base, pela API. A chamada acontece no servidor: o segredo
 * interno nunca chega ao navegador.
 *
 * O retorno é sempre o mesmo para endereço novo, pendente ou já confirmado — a
 * tela não revela quem está cadastrado.
 */
export async function subscribe(input: { email: string; consent: boolean }): Promise<SubscribeResult> {
  const parsed = subscribeInput.safeParse(input);
  if (!parsed.success) return { ok: false };

  const requestHeaders = await headers();

  const result = await apiFetch<{ status: string }>("/subscriber", {
    method: "POST",
    body: {
      email: parsed.data.email,
      // Prova de opt-in exigida pela LGPD. Atrás do Caddy o IP real é o primeiro da lista.
      consentIp: requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim(),
      consentUserAgent: requestHeaders.get("user-agent") ?? undefined,
    },
  });

  return { ok: result.ok };
}
