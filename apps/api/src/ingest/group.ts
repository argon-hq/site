import { Array as Arr, Either, Order } from "effect";
import type { TextKind } from "./parse";
import type { Signal } from "./score";
import { similarity } from "./signature";
import type { FeedKind } from "./source";
import { CROSS_COVERAGE, CUTOFF, MAX_FICHAS, SAME_FACT } from "./triage";

// One item that survived the filters and got its own score, held in memory for the run.
export type Candidate = {
  url: string; // canonical
  sourceId: string;
  sourceName: string;
  trust: number;
  origin: FeedKind;
  title: string;
  publishedAt: Date;
  text: string | null;
  textKind: TextKind;
  score: number;
  signals: Signal[];
  signature: number[];
};

// What the ficha keeps of the other outlets that told the same fact, most relevant first: where the
// page read of ARG-124 falls back when the representative's page is closed.
export type Member = { url: string; sourceName: string; title: string; textKind: TextKind };

export type Group = {
  representative: Candidate;
  members: Member[];
  sources: number;
  score: number;
  signals: Signal[];
  signatures: number[][]; // every member's, for the check against what is already known
};

// A fact the newsletter already carried, or already holds as a ficha: a link and its title's signature.
export type Known = { url: string; signature: number[] };

export type Republished = { group: Group; match: string };

export type Ranked = {
  kept: Group[];
  belowCutoff: Group[];
  overCap: Group[];
  republished: Republished[];
};

const TEXT_RANK: Record<TextKind, number> = { full: 2, summary: 1, none: 0 };

// The same link listed by two addresses of one source (Valor's sitemap and its section feed) is one
// item: the one with more text wins.
export function dedupeByUrl(candidates: readonly Candidate[]): Candidate[] {
  const byUrl = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const held = byUrl.get(candidate.url);
    if (!held || TEXT_RANK[candidate.textKind] > TEXT_RANK[held.textKind]) byUrl.set(candidate.url, candidate);
  }
  return [...byUrl.values()];
}

// Items whose titles tell the same fact become one group, by union over every pair at or above
// SAME_FACT. A few hundred items a run: the pairs are cheap, and transitive — A like B and B like C
// is one fact told three ways.
export function groupSameFact(candidates: readonly Candidate[]): Group[] {
  const parent = candidates.map((_, i) => i);
  const root = (i: number): number => {
    let current = i;
    for (let up = parent[current]; up !== undefined && up !== current; up = parent[current]) {
      parent[current] = parent[up] ?? up; // halve the path on the way up
      current = up;
    }
    return current;
  };
  candidates.forEach((a, i) => {
    candidates.slice(i + 1).forEach((b, offset) => {
      if (similarity(a.signature, b.signature) >= SAME_FACT) parent[root(i + 1 + offset)] = root(i);
    });
  });

  const clusters = new Map<number, Candidate[]>();
  candidates.forEach((candidate, i) => {
    const key = root(i);
    const cluster = clusters.get(key);
    if (cluster) cluster.push(candidate);
    else clusters.set(key, [candidate]);
  });
  return [...clusters.values()].map(toGroup);
}

const higherScore = Order.mapInput(Order.reverse(Order.number), (c: Candidate) => c.score);
const higherTrust = Order.mapInput(Order.reverse(Order.number), (c: Candidate) => c.trust);
const earlier = Order.mapInput(Order.Date, (c: Candidate) => c.publishedAt);
const byRelevance = Order.combineAll([higherScore, higherTrust, earlier]);
const byTrust = Order.combineAll([higherTrust, higherScore, earlier]);

// The most trusted outlet represents the fact; among equals, the better title, then the earlier
// one. The group's score is its best title plus a point per extra outlet.
function toGroup(cluster: readonly Candidate[]): Group {
  const ranked = Arr.sort(cluster, byRelevance);
  const best = ranked[0] ?? cluster[0];
  const representative = Arr.sort(cluster, byTrust)[0] ?? best;
  if (!best || !representative) throw new Error("a cluster has at least one candidate");
  const sources = new Set(cluster.map((c) => c.sourceId)).size;
  const cross = Math.min(CROSS_COVERAGE.max, (sources - 1) * CROSS_COVERAGE.perSource);
  const signals = cross > 0 ? [...best.signals, { signal: CROSS_COVERAGE.signal, points: cross }] : best.signals;
  return {
    representative,
    members: ranked
      .filter((c) => c !== representative)
      .map(({ url, sourceName, title, textKind }) => ({ url, sourceName, title, textKind })),
    sources,
    score: best.score + cross,
    signals,
    signatures: cluster.map((c) => c.signature),
  };
}

// A group whose fact was already published, or is already a ficha, within the last days is a late
// copy: the outlet that runs the news a day later does not bring it back.
export function findRepublished(group: Group, known: readonly Known[]): string | null {
  const match = known.find((k) => group.signatures.some((s) => similarity(s, k.signature) >= SAME_FACT));
  return match?.url ?? null;
}

const bestFirst = Order.combineAll([
  Order.mapInput(Order.reverse(Order.number), (g: Group) => g.score),
  Order.mapInput(Order.reverse(Order.Date), (g: Group) => g.representative.publishedAt),
]);

// Cut, order and cap. The order is global, over every source: score, then the most recent.
export function rank(groups: readonly Group[], known: readonly Known[]): Ranked {
  const [fresh, republished] = Arr.partitionMap(groups, (group) => {
    const match = findRepublished(group, known);
    return match ? Either.right({ group, match } satisfies Republished) : Either.left(group);
  });
  const [belowCutoff, passing] = Arr.partition(fresh, (group) => group.score >= CUTOFF);
  const ordered = Arr.sort(passing, bestFirst);
  return {
    kept: ordered.slice(0, MAX_FICHAS),
    overCap: ordered.slice(MAX_FICHAS),
    belowCutoff,
    republished,
  };
}
