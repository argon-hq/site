"use server";

import { apiFetch } from "@/lib/api";
import { tokenSchema } from "@/lib/token";

type ConfirmResult =
  | { ok: true; status: "confirmed" | "already_confirmed" }
  | { ok: false; reason: "expired" | "invalid" | "error" };

/**
 * Confirma a inscrição. É um POST: scanner de link de cliente de e-mail abre toda
 * URL que encontra, e confirmar num GET valeria como aceite que a pessoa não deu.
 */
export async function confirm(token: string): Promise<ConfirmResult> {
  // Public endpoint: a token with the wrong shape never reaches the API.
  const parsed = tokenSchema.safeParse(token);
  if (!parsed.success) return { ok: false, reason: "invalid" };

  const result = await apiFetch<{ status: string }>("/subscriber/confirm", {
    method: "POST",
    body: { token: parsed.data },
  });

  if (!result.ok) return { ok: false, reason: "error" };

  switch (result.data.status) {
    case "confirmed":
    case "already_confirmed":
      return { ok: true, status: result.data.status };
    case "expired":
      return { ok: false, reason: "expired" };
    default:
      return { ok: false, reason: "invalid" };
  }
}
