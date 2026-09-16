import { createTool } from "@mastra/core/tools";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { z } from "zod";
import { extractedArticleSchema, type ExtractedArticle } from "../schemas/article";

// Regras duras ficam aqui, não no prompt.
const TIMEOUT_MS = 10_000;
const MAX_HTML_BYTES = 2_000_000;
const MAX_TEXT_CHARS = 12_000;
const USER_AGENT = "ArgonNewsletterBot/0.1 (+https://argon.com.br)";

// Função pura, usada pela ferramenta e por código que não passa pelo agente.
export async function extractArticle(url: string): Promise<ExtractedArticle> {
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "text/html" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} em ${url}`);

  const html = (await response.text()).slice(0, MAX_HTML_BYTES);
  const { document } = parseHTML(html);
  const canonical =
    document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.getAttribute("href") ??
    response.url;
  const published =
    document.querySelector('meta[property="article:published_time"]')?.getAttribute("content") ??
    document.querySelector("time[datetime]")?.getAttribute("datetime") ??
    null;

  const article = new Readability(document as unknown as Document).parse();
  if (!article?.textContent?.trim()) throw new Error(`Sem texto legível em ${url}`);

  return {
    canonicalUrl: new URL(canonical, response.url).toString(),
    originalTitle: article.title?.trim() || document.title.trim(),
    extractedText: article.textContent.replace(/\s+\n/g, "\n").trim().slice(0, MAX_TEXT_CHARS),
    siteName: article.siteName ?? null,
    publishedAt: published,
  };
}

export const readPage = createTool({
  id: "read_page",
  description: "Lê uma página de notícia e devolve título, texto principal e URL canônica.",
  inputSchema: z.object({ url: z.string().url() }),
  outputSchema: extractedArticleSchema,
  execute: ({ url }) => extractArticle(url),
});
