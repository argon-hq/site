import { z } from "zod";
import { apiFetch } from "@/lib/api";
import { tokenSchema } from "@/lib/token";

/*
 * O ciclo da inscrição, chamado pelos formulários e painéis no navegador. As rotas da API são
 * públicas, então a validação daqui é só para não gastar uma ida à rede com entrada que a API
 * recusaria — quem garante é a API.
 */

// Trim and lowercase first, then check the shape, as the API expects it.
const subscribeInput = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  consent: z.literal(true),
});

type SubscribeResult = { ok: boolean };

/**
 * Grava o e-mail na base, pela API. A prova de opt-in (IP e user-agent, LGPD) a API tira da
 * própria requisição: o que o navegador mandasse no corpo, qualquer um poderia forjar.
 *
 * O retorno é sempre o mesmo para endereço novo, pendente ou já confirmado — a
 * tela não revela quem está cadastrado.
 */
export async function subscribe(input: { email: string; consent: boolean }): Promise<SubscribeResult> {
  const parsed = subscribeInput.safeParse(input);
  if (!parsed.success) return { ok: false };

  const result = await apiFetch<{ status: string }>("/subscriber", {
    method: "POST",
    body: { email: parsed.data.email },
  });

  return { ok: result.ok };
}

type ConfirmResult =
  { ok: true; status: "confirmed" | "already_confirmed" } | { ok: false; reason: "expired" | "invalid" | "error" };

/**
 * Confirma a inscrição. É um POST: scanner de link de cliente de e-mail abre toda
 * URL que encontra, e confirmar num GET valeria como aceite que a pessoa não deu.
 */
export async function confirm(token: string): Promise<ConfirmResult> {
  // A token with the wrong shape never reaches the API.
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

export type Subscription = { email: string; status: string };

/**
 * Quem é o dono do token, para a tela confirmar antes de cancelar. Só leitura.
 *
 * Cancelar no GET descadastraria sozinho — scanner de link de cliente de e-mail abre a
 * página sem ninguém clicar em nada.
 */
export async function lookupSubscription(token: string): Promise<Subscription | null> {
  const parsed = tokenSchema.safeParse(token);
  if (!parsed.success) return null;

  // Token desconhecido chega como 404: para a tela, é o mesmo link inválido.
  const result = await apiFetch<Subscription>(`/subscriber/unsubscribe?token=${encodeURIComponent(parsed.data)}`);
  return result.ok ? result.data : null;
}

type UnsubscribeResult = { ok: true; status: "cancelled" | "already_cancelled"; email: string } | { ok: false };

/** Cancela de verdade. Só é chamada pelo botão da página, nunca ao abrir. */
export async function unsubscribe(token: string): Promise<UnsubscribeResult> {
  // A token with the wrong shape never reaches the API.
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
