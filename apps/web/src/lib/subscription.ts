import { apiFetch } from "@/lib/api";

export type Subscription = { email: string; status: string };

/**
 * O que a página de cancelamento sabe sobre o link. `invalid` é a API dizendo que ninguém tem o
 * token; `unavailable` é a API sem responder, e aí o link pode estar perfeitamente bom.
 */
export type SubscriptionLookup =
  { kind: "found"; subscription: Subscription } | { kind: "invalid" } | { kind: "unavailable" };

/**
 * Quem é o dono do token, para a tela confirmar antes de cancelar. Só leitura, e de
 * propósito fora de `actions/`: não há motivo para expor uma consulta como endpoint.
 *
 * Cancelar no GET descadastraria sozinho — scanner de link de cliente de e-mail abre
 * a página sem ninguém clicar em nada.
 */
export async function lookupSubscription(token: string): Promise<SubscriptionLookup> {
  const result = await apiFetch<Subscription>(`/subscriber/unsubscribe?token=${encodeURIComponent(token)}`);
  if (result.ok) return { kind: "found", subscription: result.data };
  // Só o 404 diz que o link não vale. Queda, 5xx ou segredo errado são problema nosso, e dizer
  // "link inválido" a quem quer sair da lista é o que faz a pessoa marcar a newsletter como spam.
  return result.status === 404 ? { kind: "invalid" } : { kind: "unavailable" };
}
