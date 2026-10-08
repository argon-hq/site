import { sectionOf, type SectionRule } from "./source";
import { FOREIGN, NOISE, normalize, SECTION_POINTS, TITLE_RULES } from "./triage";

// Every point a title earned or lost, with the reason, so a run can say why an item passed or fell.
export type Signal = { signal: string; points: number };

export type Scored =
  | { outcome: "scored"; score: number; signals: Signal[] }
  | { outcome: "discarded"; reason: string; signals: Signal[] };

export type ScoreInput = {
  title: string;
  url: URL;
  categories: readonly string[];
  sectionRules: readonly SectionRule[];
};

// One item, on its own: section and title. The source's trust is not a point — it picks the
// group's representative — and what depends on the other items, the same fact in other outlets, is
// added when the groups are known.
export function scoreItem(input: ScoreInput): Scored {
  const section = sectionOf(input.url, input.categories, input.sectionRules);
  if (section.tier === "discard") return { outcome: "discarded", reason: `section ${section.rule}`, signals: [] };

  const title = normalize(input.title);
  const noise = NOISE.find((rule) => rule.pattern.test(title));
  if (noise) return { outcome: "discarded", reason: `noise ${noise.signal}`, signals: [] };

  const signals: Signal[] = [];
  const sectionPoints = SECTION_POINTS[section.tier];
  if (sectionPoints !== 0) signals.push({ signal: `section_${section.tier}`, points: sectionPoints });
  for (const rule of TITLE_RULES) {
    // A rule with `requires` counts only when the title also carries what it requires.
    if (rule.pattern.test(title) && (!rule.requires || rule.requires.test(title))) {
      signals.push({ signal: rule.signal, points: rule.points });
    }
  }
  if (FOREIGN.foreign.test(title) && !FOREIGN.brazil.test(title)) {
    signals.push({ signal: FOREIGN.signal, points: FOREIGN.points });
  }

  return { outcome: "scored", score: total(signals), signals };
}

export function total(signals: readonly Signal[]): number {
  return signals.reduce((sum, s) => sum + s.points, 0);
}
