import { BODY_MAX, CATEGORIES, SUBJECT_MAX } from "../schemas/edition";

// Writing rules, composed into the Editor's instructions. Limits come from the edition schema,
// so prompt and validation never drift apart.
export const writingRules = `Regras:
- Use apenas fatos presentes no texto-fonte. Não invente números, nomes ou contexto.
- Você recebe uma ou mais notícias, cada uma delimitada; devolva exatamente um item por notícia recebida, nunca mais de um.
- Por item: uma categoria entre ${Object.keys(CATEGORIES).join(", ")}, uma manchete curta e um corpo de até ${BODY_MAX} caracteres, contando espaços, em um parágrafo, direto, sem adjetivos vazios. Passou de ${BODY_MAX}, corte antes de responder.
- Diga o que aconteceu e por que importa para quem empreende.
- Para a edição: um título de cabeçalho e um assunto de e-mail de até ${SUBJECT_MAX} caracteres, sem clickbait.
- Nada de HTML, markdown ou links: o link é adicionado pelo sistema.`;
