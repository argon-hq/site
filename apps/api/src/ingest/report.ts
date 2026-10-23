import { Struct } from "effect";
import type { Group } from "./group";
import type { Signal } from "./score";
import type { SourceFeed } from "./source";

// What a run says of itself, item by item, address by address and group by group. The manual
// commands print it whole and the debug layer logs it; the route and the workflow keep the counts.

export type Decision =
  "no_date" | "out_of_window" | "future" | "bad_url" | "off_domain" | "seen" | "discarded" | "candidate";

export type ItemReport = {
  source: string;
  feed: string;
  url: string;
  title: string;
  publishedAt: string | null;
  decision: Decision;
  reason?: string;
  score?: number;
  signals?: Signal[];
};

export type FeedReport = {
  source: string;
  url: string;
  kind: SourceFeed["kind"];
  ok: boolean;
  status: number | null;
  error?: string;
  listed: number;
  inWindow: number;
  candidates: number;
  dropped: Partial<Record<Decision, number>>;
  discarded: Record<string, number>;
  durationMs: number;
};

export type GroupOutcome = "ficha" | "below_cutoff" | "over_cap" | "republished";

export type GroupReport = {
  url: string;
  source: string;
  title: string;
  score: number;
  signals: Signal[];
  members: { url: string; source: string; title: string }[];
  outcome: GroupOutcome;
  match?: string;
};

export type IngestReport = {
  runId: string;
  date: string;
  since: string;
  dryRun: boolean;
  sources: number;
  sourcesFailed: string[];
  feeds: FeedReport[];
  listed: number;
  inWindow: number;
  candidates: number;
  groups: number;
  fichas: number;
  duplicates: number;
  belowCutoff: number;
  overCap: number;
  republished: number;
  durationMs: number;
  items: ItemReport[];
  groupsDetail: GroupReport[];
};

// The counts, without the items: what the log line, the route and the workflow carry.
export const summaryOf = (report: IngestReport) => ({
  ...Struct.omit(report, "items", "groupsDetail"),
  feeds: report.feeds.map((feed) => Struct.omit(feed, "kind", "error", "discarded")),
});

export type IngestSummary = ReturnType<typeof summaryOf>;

export function groupReport(group: Group, outcome: GroupOutcome): GroupReport {
  const { representative } = group;
  return {
    url: representative.url,
    source: representative.sourceName,
    title: representative.title,
    score: group.score,
    signals: group.signals,
    members: group.members.map((member) => ({ url: member.url, source: member.sourceName, title: member.title })),
    outcome,
  };
}
