import { BODY_MAX, SUBJECT_MAX } from "../mastra/schemas/edition";

// The one external stylesheet allowed. Clients that do not load it fall back to the font stack.
export const FONT_STYLESHEET = "https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap";

// Figma tokens (node 6:5 "Email recebido"). Safe fonts with Inter first.
export const theme = {
  width: 600,
  font: "Inter, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  color: {
    page: "#f4f4f5",
    card: "#ffffff",
    dark: "#1a1a1a",
    border: "#e0e0e0",
    link: "#2563eb",
    text: "#1a1a1a",
    body: "#555555",
    muted: "#888888",
    signoff: "#444444",
    headerMuted: "#aaaaaa",
    brandPlaceholder: "#d9d9d9",
  },
} as const;

// Length limits shared with the writer schema; the database check constraints use the same values.
export const limits = {
  subjectMax: SUBJECT_MAX,
  bodyMax: BODY_MAX,
  htmlMaxBytes: 100 * 1024, // Gmail clips at 102 KB
} as const;
