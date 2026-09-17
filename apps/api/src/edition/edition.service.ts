import { Injectable, Logger } from "@nestjs/common";
import { MastraService } from "@mastra/nestjs";
import { extractArticle } from "../mastra/tools/read-page";
import { writtenEditionSchema, type WrittenEdition } from "../mastra/schemas/edition";

export type WriteResult = {
  article: { canonicalUrl: string; originalTitle: string; siteName: string | null };
  edition: WrittenEdition;
  usage: unknown;
};

@Injectable()
export class EditionService {
  private readonly logger = new Logger(EditionService.name);

  constructor(private readonly mastra: MastraService) {}

  // Minimal pipeline: one article, the writer agent, structured output.
  async writeFromUrl(url: string): Promise<WriteResult> {
    const article = await extractArticle(url);
    this.logger.log({ msg: "article extracted", url: article.canonicalUrl, chars: article.extractedText.length });

    const writer = this.mastra.getAgent("writer");
    const prompt = [
      "Escreva a edição de hoje com a única notícia abaixo: exatamente um item.",
      `Fonte: ${article.siteName ?? new URL(article.canonicalUrl).hostname}`,
      `Título original: ${article.originalTitle}`,
      "--- notícia ---",
      article.extractedText,
      "--- fim ---",
    ].join("\n");

    // Two attempts per item, as decided in the architecture: the second one carries the validation error.
    let result;
    try {
      result = await writer.generate(prompt, { structuredOutput: { schema: writtenEditionSchema } });
    } catch (error) {
      this.logger.warn({ msg: "first attempt rejected, retrying", error: String(error) });
      result = await writer.generate(
        `${prompt}\n\nA tentativa anterior foi rejeitada: ${String(error).slice(0, 400)}. Corrija e responda de novo.`,
        { structuredOutput: { schema: writtenEditionSchema } },
      );
    }
    this.logger.log({ msg: "edition written", subject: result.object.subject, usage: result.usage });

    return {
      article: { canonicalUrl: article.canonicalUrl, originalTitle: article.originalTitle, siteName: article.siteName },
      edition: result.object,
      usage: result.usage ?? null,
    };
  }
}
