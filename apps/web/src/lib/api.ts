/**
 * Chamadas à API, sempre do servidor: o `INTERNAL_API_SECRET` nunca chega ao navegador.
 *
 * Erro nunca vira exceção — quem chama decide o que mostrar na tela.
 */
type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number | null };

export async function apiFetch<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<ApiResult<T>> {
  const apiUrl = process.env.API_URL;
  const secret = process.env.INTERNAL_API_SECRET;

  if (!apiUrl || !secret) {
    console.error({ msg: "api: API_URL ou INTERNAL_API_SECRET ausente", path });
    return { ok: false, status: null };
  }

  try {
    const response = await fetch(`${apiUrl}${path}`, {
      method: init?.method ?? "GET",
      headers: { "content-type": "application/json", "x-internal-secret": secret },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
    });

    if (!response.ok) {
      console.error({ msg: "api: resposta de erro", path, status: response.status });
      return { ok: false, status: response.status };
    }

    return { ok: true, data: (await response.json()) as T };
  } catch (error) {
    console.error({ msg: "api: inacessível", path, error: String(error) });
    return { ok: false, status: null };
  }
}
