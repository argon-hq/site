// Pipeline mínimo: uma notícia → Redator → edição escrita em out/.
// O Construtor HTML entra na ARG-76. Sem banco e sem envio. Uso: pnpm pipeline:min <url>

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { mastra } from "./mastra";
import { writtenEditionSchema } from "./schemas/edition";
import { extractArticle } from "./tools/read-page";

const url = process.argv[2];
if (!url) {
  console.error("Uso: pnpm pipeline:min <url-da-noticia>");
  process.exit(1);
}

const startedAt = Date.now();

// 1. Ingestão: a ferramenta roda direto, sem agente, até o Ingestor existir (ARG-96).
const article = await extractArticle(url);
console.log(`Notícia: ${article.originalTitle} (${article.extractedText.length} caracteres)`);

// 2. Redação: saída estruturada, validada pelo esquema.
const writer = mastra.getAgent("writer");
const result = await writer.generate(
  [
    "Escreva a edição de hoje com a notícia abaixo.",
    `Fonte: ${article.siteName ?? new URL(article.canonicalUrl).hostname}`,
    `Título original: ${article.originalTitle}`,
    "",
    article.extractedText,
  ].join("\n"),
  { structuredOutput: { schema: writtenEditionSchema } },
);
const edition = result.object;
console.log(`Assunto: ${edition.subject}`);

// 3. Saída em disco: edição escrita, com a URL canônica anexada a cada item.
const outDir = path.resolve("out");
const stem = new Date().toISOString().slice(0, 10);
await mkdir(outDir, { recursive: true });
const output = {
  date: stem,
  title: edition.title,
  subject: edition.subject,
  items: edition.items.map((item) => ({ ...item, url: article.canonicalUrl })),
};
await writeFile(path.join(outDir, `${stem}.json`), JSON.stringify(output, null, 2));

console.log(`Edição escrita: out/${stem}.json`);
console.log(`Tokens: ${JSON.stringify(result.usage ?? null)} · ${Date.now() - startedAt} ms`);
