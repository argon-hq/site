import { apiFetch } from "@/lib/api";

export type Subscription = { email: string; status: string };

/**
 * Quem é o dono do token, para a tela confirmar antes de cancelar. Só leitura, e de
 * propósito fora de `actions/`: não há motivo para expor uma consulta como endpoint.
 *
 * Cancelar no GET descadastraria sozinho — scanner de link de cliente de e-mail abre
 * a página sem ninguém clicar em nada.
 */
export async function lookupSubscription(token: string): Promise<Subscription | null> {
  const result = await apiFetch<Subscription>(`/subscriber/unsubscribe?token=${encodeURIComponent(token)}`);
  return result.ok ? result.data : null;
}
