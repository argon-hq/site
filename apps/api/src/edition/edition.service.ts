import { Injectable, Logger } from "@nestjs/common";
import { MastraService } from "@mastra/nestjs";
import { Data, Effect } from "effect";
import { writtenEditionSchema, type WrittenEdition } from "../mastra/schemas/edition";
import { fetchArticle } from "../mastra/tools/read-page";

export class WriteFailed extends Data.TaggedError("WriteFailed")<{ reason: string }> {}

export type WriteResult = {
  article: { canonicalUrl: string; originalTitle: string; siteName: string | null };
  edition: WrittenEdition;
  usage: unknown;
};

@Injectable()
export class EditionService {
  private readonly logger = new Logger(EditionService.name);

  constructor(private readonly mastra: MastraService) {}

  // Minimal pipeline: one article, the Editor, structured output.
  writeFromUrl(url: string): Effect.Effect<WriteResult, WriteFailed> {
    return Effect.gen(this, function* () {
      const article = yield* fetchArticle(url).pipe(
        Effect.mapError((error) => new WriteFailed({ reason: `${error._tag}: ${error.reason}` })),
      );
      this.logger.log({ msg: "article extracted", url: article.canonicalUrl, chars: article.extractedText.length });

      const editor = this.mastra.getAgent("editor");
      const prompt = [
        "Escreva a edição de hoje com a única notícia abaixo: exatamente um item.",
        `Fonte: ${article.siteName ?? new URL(article.canonicalUrl).hostname}`,
        `Título original: ${article.originalTitle}`,
        "--- notícia ---",
        article.extractedText,
        "--- fim ---",
      ].join("\n");

      const write = (text: string) =>
        Effect.tryPromise({
          try: () => editor.generate(text, { structuredOutput: { schema: writtenEditionSchema } }),
          catch: (error) => new WriteFailed({ reason: String(error) }),
        });

      // Two attempts per item, as decided in the architecture: the second one carries the validation error.
      const result = yield* write(prompt).pipe(
        Effect.catchTag("WriteFailed", (rejected) =>
          Effect.sync(() => this.logger.warn({ msg: "first attempt rejected, retrying", reason: rejected.reason })).pipe(
            Effect.andThen(
              write(`${prompt}\n\nA tentativa anterior foi rejeitada: ${rejected.reason.slice(0, 400)}. Corrija e responda de novo.`),
            ),
          ),
        ),
      );
      this.logger.log({ msg: "edition written", subject: result.object.subject, usage: result.usage });

      return {
        article: { canonicalUrl: article.canonicalUrl, originalTitle: article.originalTitle, siteName: article.siteName },
        edition: result.object,
        usage: result.usage ?? null,
      };
    }).pipe(Effect.tapError((error) => Effect.sync(() => this.logger.error({ msg: "write failed", url, reason: error.reason }))));
  }
}
