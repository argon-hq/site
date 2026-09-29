import { limits } from "../theme";
import type { EditionInput, EditionItem } from "../types";
import { editionFixture } from "./edition";

// Edge cases: six items, subject, headline and body at the maximum length, long category,
// short body. Lets the snapshot catch bad line breaks before the visual review.

const exact = (text: string, length: number) =>
  text.length >= length ? text.slice(0, length) : text.padEnd(length, ".");

const longHeadline = exact(
  "Governo anuncia pacote de crédito para pequenas empresas com juros abaixo da SELIC e prazo de dez anos para pagar, diz ministério",
  120,
);
const longBody = exact(
  "Medida provisória publicada hoje libera R$ 20 bilhões via BNDES para empresas com faturamento de até R$ 4,8 milhões por ano; bancos começam a operar as linhas na próxima semana, com carência.",
  limits.bodyMax,
);

const items: EditionItem[] = [
  {
    category: "Mercado de Trabalho e Carreira",
    headline: longHeadline,
    body: longBody,
    url: "https://example.com/noticias/credito-pequenas-empresas",
  },
  {
    category: "Economia",
    headline: "SELIC cai",
    body: "Copom reduz a taxa para 10,5% ao ano.",
    url: "https://example.com/noticias/selic",
  },
  ...editionFixture.items.slice(0, 4),
];

export const editionEdgeFixture: EditionInput = {
  ...editionFixture,
  title: exact(
    "Crédito para pequenas, SELIC em queda e mais quatro notícias que importam para quem empreende hoje",
    80,
  ),
  subject: exact(
    "Crédito de R$ 20 bi para pequenas empresas e SELIC em queda: o que muda para você",
    limits.subjectMax,
  ),
  items,
};
