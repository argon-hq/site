import { Injectable, Logger } from "@nestjs/common";
import type { Dataset } from "@mastra/core/datasets";
import { MastraService } from "@mastra/nestjs";
import { Data, Effect } from "effect";
import { NOT_FOUND, type Failure } from "../effect/failure";
import { writeFidelity } from "../mastra/scorers";
import { PrismaService } from "../prisma/prisma.service";
import { editionDate } from "./rules";
import { itemPrompt, type Candidate } from "./write";

export class DatasetFailed extends Data.TaggedError("DatasetFailed")<Failure> {}

// The writing step's test set: real articles, each as the exact prompt the step gives the Editor. An
// experiment in the Studio runs the Editor over every item — against a version of its instructions
// saved in the Editor, if one is picked — and the fidelity judge scores each answer, so a change to
// the prompt is compared on the same articles before it writes a real edition.
export const WRITE_DATASET = "write";

export type DatasetAdded = { dataset: string; date: string; added: number; alreadyThere: number; withoutText: number };

@Injectable()
export class WriteDataset {
  private readonly logger = new Logger(WriteDataset.name);

  constructor(
    private readonly mastra: MastraService,
    private readonly prisma: PrismaService,
  ) {}

  private call<A>(what: string, run: () => Promise<A>): Effect.Effect<A, DatasetFailed> {
    return Effect.tryPromise({
      try: run,
      catch: (error) =>
        new DatasetFailed({ reason: `${what}: ${error instanceof Error ? error.message : String(error)}` }),
    });
  }

  // The dataset is created the first time it is needed, aimed at the Editor and judged by fidelity.
  private dataset(): Effect.Effect<Dataset, DatasetFailed> {
    const datasets = this.mastra.getMastra().datasets;
    return Effect.tryPromise(() => datasets.get({ id: WRITE_DATASET })).pipe(
      Effect.orElse(() =>
        this.call("create dataset", () =>
          datasets.create({
            id: WRITE_DATASET,
            name: WRITE_DATASET,
            description:
              "Real articles as the writing step prompts the Editor with them. Run as an experiment on the editor agent.",
            targetType: "agent",
            targetIds: ["editor"],
            scorerIds: [writeFidelity.id],
          }),
        ),
      ),
    );
  }

  // Every article of a day's edition that still has its text (it is cleared after 30 days) becomes
  // an item, once: the article's address is the item's identity, so adding a day twice adds nothing.
  addEdition(date: string | undefined, now: Date = new Date()): Effect.Effect<DatasetAdded, DatasetFailed> {
    const day = date ? new Date(`${date}T00:00:00Z`) : editionDate(now);
    const label = day.toISOString().slice(0, 10);
    return Effect.gen(this, function* () {
      const articles = yield* this.call("read articles", () =>
        this.prisma.article.findMany({
          where: { edition: { date: day } },
          select: { id: true, canonicalUrl: true, sourceName: true, originalTitle: true, extractedText: true },
          orderBy: { score: "desc" },
        }),
      );
      if (articles.length === 0) {
        return yield* new DatasetFailed({ reason: `edition ${label} has no articles`, status: NOT_FOUND });
      }
      const dataset = yield* this.dataset();
      const existing = yield* this.call("list items", () => dataset.listItems({ page: 0, perPage: 1000 }));
      const known = new Set(
        (Array.isArray(existing) ? existing : existing.items).map((item) => item.externalId).filter(Boolean),
      );

      const withText = articles.filter((article): article is Candidate => Boolean(article.extractedText));
      const fresh = withText.filter((article) => !known.has(article.canonicalUrl));
      if (fresh.length > 0) {
        yield* this.call("add items", () =>
          dataset.addItems({
            items: fresh.map((article) => ({
              externalId: article.canonicalUrl,
              input: itemPrompt(article),
              metadata: {
                url: article.canonicalUrl,
                source: article.sourceName,
                title: article.originalTitle,
                date: label,
              },
            })),
          }),
        );
      }
      const added = {
        dataset: WRITE_DATASET,
        date: label,
        added: fresh.length,
        alreadyThere: withText.length - fresh.length,
        withoutText: articles.length - withText.length,
      };
      this.logger.log({ msg: "dataset items added", ...added });
      return added;
    });
  }
}
