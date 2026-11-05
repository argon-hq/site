import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Dataset } from "@mastra/core/datasets";
import { Data, Effect } from "effect";
import { NOT_FOUND, type Failure } from "../effect/failure";
import { WRITE_FIDELITY_SCORER } from "../mastra/scorer-ids";
import { MASTRA, type ArgonMastra } from "../mastra/token";
import { PrismaService } from "../prisma/prisma.service";
import { dayOf } from "./delivery-status";
import { itemPrompt, type Candidate } from "./write";

export class DatasetFailed extends Data.TaggedError("DatasetFailed")<Failure> {}

// The writing step's test set: real articles, each as the exact prompt the step gives the Editor. An
// experiment in the Studio runs the Editor over every item and the fidelity judge scores each
// answer, so a change to the agent's text is compared on the same articles before it ships.
export const WRITE_DATASET = "write";

// A São Paulo calendar day, as instants: it starts at 03:00 UTC.
const SAO_PAULO_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type DatasetAdded = { dataset: string; date: string; added: number; alreadyThere: number };

@Injectable()
export class WriteDataset {
  private readonly logger = new Logger(WriteDataset.name);

  constructor(
    @Inject(MASTRA) private readonly mastra: ArgonMastra,
    private readonly prisma: PrismaService,
  ) {}

  private call<A>(what: string, run: () => Promise<A>): Effect.Effect<A, DatasetFailed> {
    return Effect.tryPromise({
      try: run,
      catch: (error) =>
        new DatasetFailed({ reason: `${what}: ${error instanceof Error ? error.message : String(error)}` }),
    });
  }

  // Created the first time it is needed, aimed at the Editor and judged by fidelity.
  private dataset(): Effect.Effect<Dataset, DatasetFailed> {
    const datasets = this.mastra.datasets;
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
            scorerIds: [WRITE_FIDELITY_SCORER],
          }),
        ),
      ),
    );
  }

  // Every article the ingestion stored that day and that still has its text becomes an item, once:
  // the article's address is the item's identity, so adding a day twice adds nothing. The text is
  // cleared once an edition is sent, so the days worth adding are the recent ones — on a local
  // database, the ones `db:pull` brought or a local run ingested.
  addDay(date: string | undefined, now: Date = new Date()): Effect.Effect<DatasetAdded, DatasetFailed> {
    const day = dayOf(date, now);
    const label = day.toISOString().slice(0, 10);
    const from = new Date(day.getTime() + SAO_PAULO_OFFSET_MS);
    return Effect.gen(this, function* () {
      const articles = yield* this.call("read articles", () =>
        this.prisma.article.findMany({
          where: { createdAt: { gte: from, lt: new Date(from.getTime() + DAY_MS) }, extractedText: { not: null } },
          select: { canonicalUrl: true, sourceName: true, originalTitle: true, extractedText: true },
          orderBy: [{ editionId: { sort: "asc", nulls: "last" } }, { codeScore: { sort: "desc", nulls: "last" } }],
        }),
      );
      if (articles.length === 0) {
        return yield* new DatasetFailed({ reason: `no article with text was stored on ${label}`, status: NOT_FOUND });
      }
      const dataset = yield* this.dataset();
      const existing = yield* this.call("list items", () => dataset.listItems({ page: 0, perPage: 1000 }));
      const known = new Set(
        (Array.isArray(existing) ? existing : existing.items).map((item) => item.externalId).filter(Boolean),
      );

      const fresh = articles.filter((article) => !known.has(article.canonicalUrl));
      if (fresh.length > 0) {
        yield* this.call("add items", () =>
          dataset.addItems({
            items: fresh.map((article) => ({
              externalId: article.canonicalUrl,
              input: itemPrompt({
                originalTitle: article.originalTitle,
                extractedText: article.extractedText ?? "",
                textFrom: { url: article.canonicalUrl, sourceName: article.sourceName, via: "feed" },
              } as Candidate),
              metadata: { url: article.canonicalUrl, source: article.sourceName, date: label },
            })),
          }),
        );
      }
      const added = {
        dataset: WRITE_DATASET,
        date: label,
        added: fresh.length,
        alreadyThere: articles.length - fresh.length,
      };
      this.logger.log({ msg: "dataset items added", ...added });
      return added;
    });
  }
}
