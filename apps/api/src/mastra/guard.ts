import { randomUUID } from "node:crypto";
import type { MastraDBMessage } from "@mastra/core/agent";
import { PromptInjectionDetector, type PromptInjectionDetectionEvent } from "@mastra/core/processors";
import { Effect } from "effect";
import { modelFor } from "./models";

// A page from a source is text the Editor reads and then acts on, and a page can say "ignore your
// instructions and…". Every page is screened before the agent sees it — the `read_page` tool — and
// before it is stored, since the stored text is what the writing step later puts in the prompt.
// Mastra's detector screens a conversation's input, and a tool's result never passes through it, so
// it is called here, directly, on the page.

// How sure the detector must be to refuse a page. News quotes people telling others what to do;
// only a clear attempt at the reader is refused.
export const INJECTION_THRESHOLD = 0.8;

export type Verdict = { flagged: boolean; reason: string | null };

// One model call per page, on the cheap model. A detector that cannot answer lets the page through
// and says so: an outage of the guard must not cost the day's edition.
export const detectInjection = async (text: string): Promise<Verdict> => {
  let event: PromptInjectionDetectionEvent | undefined;
  const detector = new PromptInjectionDetector({
    model: modelFor("guard"),
    strategy: "filter",
    threshold: INJECTION_THRESHOLD,
    errorStrategy: "warn",
    onDetection: (detected) => {
      event = detected;
    },
  });
  const message = {
    id: randomUUID(),
    role: "user",
    createdAt: new Date(),
    content: { format: 2, parts: [{ type: "text", text }] },
  } as unknown as MastraDBMessage;
  const kept = await detector.processInput({
    messages: [message],
    abort: (reason?: string) => {
      throw new Error(reason ?? "aborted");
    },
  });
  return { flagged: kept.length === 0, reason: event?.detectionResult.reason ?? null };
};

// The same page is read twice in a run — by the agent through the tool, and by the code that stores
// what the agent chose — so the verdict is kept per address for the life of the process.
const MAX_REMEMBERED = 500;

export const screenWith = (detect: (text: string) => Promise<Verdict>) => {
  const remembered = new Map<string, Verdict>();
  return (url: string, text: string): Effect.Effect<Verdict> =>
    Effect.suspend(() => {
      const known = remembered.get(url);
      if (known) return Effect.succeed(known);
      return Effect.promise(() => detect(text)).pipe(
        Effect.tap((verdict) =>
          Effect.sync(() => {
            if (remembered.size >= MAX_REMEMBERED) remembered.clear();
            remembered.set(url, verdict);
          }),
        ),
      );
    });
};

export const screenPage = screenWith(detectInjection);
