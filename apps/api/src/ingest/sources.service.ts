import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { Data, Effect } from "effect";
import { CONFLICT, NOT_FOUND, UNPROCESSABLE, type Failure } from "../effect/failure";
import { PrismaService } from "../prisma/prisma.service";
import { setAllowedDomains } from "./allowlist";
import { feedInDomain, type FeedInput, type SourceCreate, type SourcePatch } from "./sources.schema";

export class SourcesFailed extends Data.TaggedError("SourcesFailed")<Failure> {}

const UNIQUE_VIOLATION = "P2002";
const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === UNIQUE_VIOLATION;

const SELECT = {
  id: true,
  domain: true,
  name: true,
  covers: true,
  trust: true,
  active: true,
  sectionRules: true,
  lastOkAt: true,
  consecutiveFailures: true,
  alertedAt: true,
  updatedAt: true,
  feeds: { select: { id: true, kind: true, url: true }, orderBy: { url: "asc" } },
} as const;

// The sources of this environment, read and written. Every change is logged with the row before and
// after it, which is the history the table itself does not keep. The ingestion reads the table once
// per run, so a change counts from the next run.
@Injectable()
export class SourcesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SourcesService.name);

  constructor(private readonly prisma: PrismaService) {}

  // The allowlist of `read_page` is loaded at boot, so the agent can read a source before the first
  // ingestion of the day. A failure is logged, and the list stays empty — refusing everything —
  // until an ingestion reads the table.
  async onApplicationBootstrap(): Promise<void> {
    await Effect.runPromise(
      this.db(() => this.prisma.source.findMany({ where: { active: true }, select: { domain: true } })).pipe(
        Effect.tap((rows) =>
          Effect.sync(() => {
            setAllowedDomains(rows.map((row) => row.domain));
            this.logger.log({ msg: "allowlist loaded", domains: rows.length });
          }),
        ),
        Effect.catchAll((error) =>
          Effect.sync(() => this.logger.error({ msg: "allowlist not loaded", reason: error.reason })),
        ),
      ),
    );
  }

  list() {
    return this.db(() => this.prisma.source.findMany({ orderBy: { domain: "asc" }, select: SELECT }));
  }

  create(input: SourceCreate) {
    const { feeds, ...source } = input;
    return this.db(() =>
      this.prisma.source.create({ data: { ...source, feeds: { create: feeds } }, select: SELECT }),
    ).pipe(Effect.tap((after) => this.changed("created", input.domain, null, after)));
  }

  update(domain: string, patch: SourcePatch) {
    return Effect.gen(this, function* () {
      const before = yield* this.find(domain);
      const after = yield* this.db(() => this.prisma.source.update({ where: { domain }, data: patch, select: SELECT }));
      yield* this.changed("updated", domain, before, after);
      return after;
    });
  }

  addFeed(domain: string, feed: FeedInput) {
    return Effect.gen(this, function* () {
      if (!feedInDomain(feed.url, domain))
        return yield* new SourcesFailed({ reason: `${feed.url} is not on ${domain}`, status: UNPROCESSABLE });
      const before = yield* this.find(domain);
      yield* this.db(() => this.prisma.sourceFeed.create({ data: { sourceId: before.id, ...feed } }));
      const after = yield* this.find(domain);
      yield* this.changed("feed added", domain, before, after);
      return after;
    });
  }

  removeFeed(domain: string, feedId: string) {
    return Effect.gen(this, function* () {
      const before = yield* this.find(domain);
      if (!before.feeds.some((f) => f.id === feedId))
        return yield* new SourcesFailed({ reason: `feed ${feedId} is not one of ${domain}`, status: NOT_FOUND });
      yield* this.db(() => this.prisma.sourceFeed.delete({ where: { id: feedId } }));
      const after = yield* this.find(domain);
      yield* this.changed("feed removed", domain, before, after);
      return after;
    });
  }

  private find(domain: string) {
    return this.db(() => this.prisma.source.findUnique({ where: { domain }, select: SELECT })).pipe(
      Effect.flatMap((row) =>
        row ? Effect.succeed(row) : new SourcesFailed({ reason: `source ${domain} does not exist`, status: NOT_FOUND }),
      ),
    );
  }

  private changed(what: string, domain: string, before: unknown, after: unknown) {
    return Effect.sync(() => this.logger.log({ msg: `source ${what}`, domain, before, after }));
  }

  private db<A>(run: () => Promise<A>): Effect.Effect<A, SourcesFailed> {
    return Effect.tryPromise({
      try: run,
      catch: (error) =>
        isUniqueViolation(error)
          ? new SourcesFailed({ reason: "a source with this domain, or this feed, already exists", status: CONFLICT })
          : new SourcesFailed({ reason: String(error) }),
    });
  }
}
