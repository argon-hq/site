"use server";

import { apiFetch } from "@/lib/api";
import { tokenSchema } from "@/lib/token";

type UnsubscribeResult = { ok: true; status: "cancelled" | "already_cancelled"; email: string } | { ok: false };

/** Cancela de verdade. Só é chamada pelo botão da página, nunca ao abrir. */
export async function unsubscribe(token: string): Promise<UnsubscribeResult> {
  // Public endpoint: a token with the wrong shape never reaches the API.
  const parsed = tokenSchema.safeParse(token);
  if (!parsed.success) return { ok: false };

  const result = await apiFetch<{ status: string; email?: string }>("/subscriber/unsubscribe", {
    method: "POST",
    body: { token: parsed.data },
  });

  // `invalid` não chega como erro de rede: a API responde 200 com o status dentro.
  if (!result.ok || result.data.status === "invalid" || !result.data.email) return { ok: false };

  return {
    ok: true,
    status: result.data.status === "already_cancelled" ? "already_cancelled" : "cancelled",
    email: result.data.email,
  };
}
