import type { FeedKind } from "./source";
import type { TextKind } from "./parse";
import type { Signal } from "./score";
import { similarity } from "./signature";
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

export type Ranked = {
  kept: Group[];
  belowCutoff: Group[];
  overCap: Group[];
  republished: { group: Group; match: string }[];
};

const TEXT_RANK: Record<TextKind, number> = { full: 2, summary: 1, none: 0 };

// The same link listed by two addresses of one source (Valor's sitemap and its section feed) is one
// item: the one with more text wins.
export function dedupeByUrl(candidates: readonly Candidate[]): Candidate[] {
  const byUrl = new Map<string, Candidate>();
  for (const c of candidates) {
    const held = byUrl.get(c.url);
    if (!held || TEXT_RANK[c.textKind] > TEXT_RANK[held.textKind]) byUrl.set(c.url, c);
  }
  return [...byUrl.values()];
}

// Items whose titles tell the same fact become one group, by union over every pair at or above
// SAME_FACT. A few hundred items a run: the pairs are cheap, and transitive — A like B and B like C
// is one fact told three ways.
export function groupSameFact(candidates: readonly Candidate[]): Group[] {
  const parent = candidates.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i] as number] as number;
      i = parent[i] as number;
    }
    return i;
  };
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i] as Candidate;
      const b = candidates[j] as Candidate;
      if (similarity(a.signature, b.signature) >= SAME_FACT) parent[find(j)] = find(i);
    }
  }

  const clusters = new Map<number, Candidate[]>();
  candidates.forEach((c, i) => {
    const root = find(i);
    clusters.set(root, [...(clusters.get(root) ?? []), c]);
  });
  return [...clusters.values()].map(toGroup);
}

// The most trusted outlet represents the fact; among equals, the better title, then the earlier
// one. The group's score is its best title plus a point per extra outlet.
function toGroup(cluster: Candidate[]): Group {
  const byRelevance = [...cluster].sort(
    (a, b) => b.score - a.score || b.trust - a.trust || a.publishedAt.getTime() - b.publishedAt.getTime(),
  );
  const representative = [...cluster].sort(
    (a, b) => b.trust - a.trust || b.score - a.score || a.publishedAt.getTime() - b.publishedAt.getTime(),
  )[0] as Candidate;
  const best = byRelevance[0] as Candidate;
  const sources = new Set(cluster.map((c) => c.sourceId)).size;
  const cross = Math.min(CROSS_COVERAGE.max, (sources - 1) * CROSS_COVERAGE.perSource);
  const signals = cross > 0 ? [...best.signals, { signal: CROSS_COVERAGE.signal, points: cross }] : best.signals;
  return {
    representative,
    members: byRelevance
      .filter((c) => c !== representative)
      .map((c) => ({ url: c.url, sourceName: c.sourceName, title: c.title, textKind: c.textKind })),
    sources,
    score: best.score + cross,
    signals,
    signatures: cluster.map((c) => c.signature),
  };
}

// A group whose fact was already published, or is already a ficha, within the last days is a late
// copy: the outlet that runs the news a day later does not bring it back.
export function findRepublished(group: Group, known: readonly { url: string; signature: number[] }[]): string | null {
  for (const k of known) if (group.signatures.some((s) => similarity(s, k.signature) >= SAME_FACT)) return k.url;
  return null;
}

// Cut, order and cap. The order is global, over every source: score, then the most recent.
export function rank(groups: readonly Group[], known: readonly { url: string; signature: number[] }[]): Ranked {
  const republished: Ranked["republished"] = [];
  const fresh: Group[] = [];
  for (const group of groups) {
    const match = findRepublished(group, known);
    if (match) republished.push({ group, match });
    else fresh.push(group);
  }
  const passing = fresh
    .filter((g) => g.score >= CUTOFF)
    .sort(
      (a, b) => b.score - a.score || b.representative.publishedAt.getTime() - a.representative.publishedAt.getTime(),
    );
  return {
    kept: passing.slice(0, MAX_FICHAS),
    overCap: passing.slice(MAX_FICHAS),
    belowCutoff: fresh.filter((g) => g.score < CUTOFF),
    republished,
  };
}
