import { Effect } from "effect";
import { fixtureWrittenLength } from "../ingest/fixtures";
import {
  BODY_TARGET,
  HEADLINE_MAX,
  SUBJECT_MAX,
  TITLE_MAX,
  writtenItemSchema,
  type EditionHeader,
  type WrittenItem,
} from "../mastra/schemas/edition";
import { ItemFailed, type Candidate, type Generate } from "./write";

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

// A paragraph of exactly `length` characters, for the fixture stories that ask for one: the body
// limit is exercised below the target, inside the slack and over the ceiling.
function sized(text: string, length: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return `${clean
    .slice(0, length - 1)
    .trimEnd()
    .padEnd(length - 1, ".")}.`;
}

// The answer goes through the same schema a real generation meets, so a paragraph over the ceiling,
// or under the minimum, is rejected twice and the article leaves the edition, as it would with the model.
export const mockItem =
  (article: Candidate): Generate<WrittenItem> =>
  () => {
    const length = fixtureWrittenLength(article.canonicalUrl);
    const answer = {
      category: MOCK_CATEGORY,
      headline: trimTo(article.originalTitle, HEADLINE_MAX),
      body: length ? sized(article.extractedText, length) : trimTo(article.extractedText, BODY_TARGET),
    };
    const parsed = writtenItemSchema.safeParse(answer);
    return parsed.success
      ? Effect.succeed({ object: parsed.data, usage: undefined })
      : Effect.fail(
          new ItemFailed({ reason: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }),
        );
  };

export const mockHeader =
  (items: WrittenItem[], day: string): Generate<EditionHeader> =>
  () =>
    Effect.succeed({
      object: {
        title: trimTo(`Edição de ${day}`, TITLE_MAX),
        subject: trimTo(items[0]?.headline ?? `Edição de ${day}`, SUBJECT_MAX),
      },
      usage: undefined,
    });
