import { Effect } from "effect";
import type { PrismaClient } from "../generated/prisma/client";
import { liveDeps, type FetchDeps } from "../net/fetch";
import type { Mode } from "../pipeline/profile";
import { editionDate } from "../pipeline/rules";
import { fixtureDeps, fixturePublished, fixtureSources } from "./fixtures";
import { prismaIngestStore, type IngestStore } from "./store";

// Where an ingestion reads from and writes to. `live` reads the sources of the table over the
// network. `mock` reads the fixture's invented sources through a network that answers only them,
// and writes into the same database the same way — the fichas are real rows, so the writing step
// after it has something to write.
export function ingestWorld(mode: Mode, prisma: PrismaClient, now: Date): { store: IngestStore; fetchDeps: FetchDeps } {
  const store = prismaIngestStore(prisma);
  if (mode === "live") return { store, fetchDeps: liveDeps };
  return { store: mockStore(store, now), fetchDeps: fixtureDeps(now) };
}

// The fixture's sources have no row, so there is no health to record and no id to point at. And
// the fixture tells the same stories every day: what the database knows from earlier days is the
// fixture's own, and would make every story a late copy of yesterday's. So the past is the
// fixture's published list, and only today's fichas come from the database.
function mockStore(store: IngestStore, now: Date): IngestStore {
  return {
    ...store,
    activeSources: () => Effect.succeed(fixtureSources()),
    recordSource: () => Effect.succeed({ consecutiveFailures: 0, alert: false }),
    known: (since) =>
      store
        .known(new Date(Math.max(since.getTime(), editionDate(now).getTime())))
        .pipe(Effect.map((known) => [...fixturePublished(), ...known])),
    saveFichas: (fichas) => store.saveFichas(fichas.map((f) => ({ ...f, sourceId: null }))),
  };
}
