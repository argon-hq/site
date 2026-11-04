/**
 * Chamadas à API, direto do navegador: o site é estático, não há servidor no meio. Por isso
 * não existe segredo aqui — as rotas que o site usa são públicas na API, com CORS liberado só
 * para a origem do site.
 *
 * Erro nunca vira exceção — quem chama decide o que mostrar na tela.
 */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number | null };

/**
 * Base da API. `NEXT_PUBLIC_` porque o valor é embutido no bundle no build: cada ambiente
 * publicado tem o seu build. Sem a variável, a API local.
 */
export function apiOrigin(): string {
  return process.env.NEXT_PUBLIC_API_ORIGIN || "http://localhost:3001";
}

export async function apiFetch<T>(path: string, init?: { method?: string; body?: unknown }): Promise<ApiResult<T>> {
  try {
    const response = await fetch(`${apiOrigin()}${path}`, {
      method: init?.method ?? "GET",
      // Só com corpo: um GET sem content-type é uma requisição simples, sem preflight de CORS.
      headers: init?.body === undefined ? undefined : { "content-type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      // A API não usa cookie nenhum, e os do site (idioma, tema) não têm por que ir até ela.
      credentials: "omit",
      cache: "no-store",
    });

    if (!response.ok) {
      console.error({ msg: "api: resposta de erro", path, status: response.status });
      return { ok: false, status: response.status };
    }

    return { ok: true, data: (await response.json()) as T };
  } catch (error) {
    // Rede fora, CORS recusado ou corpo que não é JSON: para a tela, é a mesma falha.
    console.error({ msg: "api: inacessível", path, error: String(error) });
    return { ok: false, status: null };
  }
}
