import { Effect } from "effect";
import { BODY_MAX, SUBJECT_MAX, type EditionHeader, type WrittenItem } from "../mastra/schemas/edition";
import type { Candidate, Generate } from "./write";

// The writing step without a model. It answers in the same shape a generation does, so everything
// after it — the schema, the two attempts, the transaction that saves the edition — runs unchanged.
// The text is the article's own: a mocked edition is for looking at the pipeline and the layout, not
// for reading.
//
// The writing step builds one generation per article and one for the header, so each mock closes
// over what it is writing about instead of reading the prompt back.

// Cut on a word, not in the middle of one, and never longer than the schema allows.
function trimTo(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trim();
}

// One category for every mocked item: choosing it is judgement, and judgement is what the mock is
// not doing.
const MOCK_CATEGORY = "business" as const;

export const mockItem =
  (article: Candidate): Generate<WrittenItem> =>
  () =>
    Effect.succeed({
      object: {
        category: MOCK_CATEGORY,
        headline: trimTo(article.originalTitle, 120),
        body: trimTo(article.extractedText, BODY_MAX),
      },
      usage: undefined,
    });

export const mockHeader =
  (items: WrittenItem[], day: string): Generate<EditionHeader> =>
  () =>
    Effect.succeed({
      object: {
        title: trimTo(`Edição de ${day}`, 80),
        subject: trimTo(items[0]?.headline ?? `Edição de ${day}`, SUBJECT_MAX),
      },
      usage: undefined,
    });
