import { BODY_MAX, SUBJECT_MAX } from "../mastra/schemas/edition";

// The one external stylesheet allowed. Clients that do not load it (Gmail, Outlook) fall back to
// the font stack, which is what most readers see: Arial for text, Courier New for labels.
export const FONT_STYLESHEET =
  "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap";

// The Argon brand (design-systems/argon-brand/strategy.md): the argon lilac palette, Manrope with
// Geist Mono, and square corners everywhere in the newsletter. The accent goes on the links, the
// button and the rule under the header; never on running text.
export const theme = {
  width: 600,
  font: "Manrope, Arial, Helvetica, sans-serif",
  mono: "'Geist Mono', 'Courier New', Courier, monospace",
  color: {
    page: "#f5f4f8",
    card: "#ffffff",
    dark: "#121019",
    border: "#dcd9e4",
    // Lilac on white (4.8:1) and its lighter tone on the dark bands (5.4:1).
    link: "#6a4df4",
    linkOnDark: "#8b74ff",
    text: "#121019",
    body: "#3b3947",
    muted: "#5f5c6a",
    signoff: "#3b3947",
    headerMuted: "#a9a5b8",
  },
} as const;

// Length limits shared with the writer schema; the database check constraints use the same values.
export const limits = {
  subjectMax: SUBJECT_MAX,
  bodyMax: BODY_MAX,
  htmlMaxBytes: 100 * 1024, // Gmail clips at 102 KB
} as const;
