import type { CSSProperties } from "react";
import { theme } from "../../theme";

// Styles of the confirmation body, the only piece of this e-mail that is not shared. Everything
// the other templates also use lives in `email/components/styles.ts`.

const { color, font } = theme;

const noMargin = { marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0 } as const;
const marginBottom = (px: number): CSSProperties => ({ ...noMargin, marginBottom: `${px}px` });

export const content: CSSProperties = { padding: "32px 40px 28px 40px", borderBottom: `1px solid ${color.border}` };

export const heading: CSSProperties = {
  ...marginBottom(12),
  fontFamily: font,
  fontSize: "22px",
  lineHeight: "27px",
  fontWeight: 700,
  color: color.text,
};

export const body: CSSProperties = {
  ...marginBottom(24),
  fontFamily: font,
  fontSize: "14px",
  lineHeight: "20px",
  color: color.body,
};

// A table cell painted dark, not a styled <a>: Outlook ignores padding and background on links.
export const buttonCell: CSSProperties = {
  ...marginBottom(24),
  backgroundColor: color.dark,
  borderRadius: "6px",
  textAlign: "center",
};

export const button: CSSProperties = {
  display: "inline-block",
  padding: "14px 28px",
  fontFamily: font,
  fontSize: "14px",
  lineHeight: "17px",
  fontWeight: 700,
  color: "#ffffff",
  textDecoration: "none",
};

export const fallback: CSSProperties = {
  ...marginBottom(4),
  fontFamily: font,
  fontSize: "12px",
  lineHeight: "15px",
  color: color.muted,
};

// Long, unbreakable URL: it has to wrap or it stretches the 600px card on narrow clients.
export const fallbackUrl: CSSProperties = {
  ...marginBottom(24),
  fontFamily: font,
  fontSize: "12px",
  lineHeight: "15px",
  color: color.link,
  wordBreak: "break-all",
};

export const note: CSSProperties = {
  ...marginBottom(8),
  fontFamily: font,
  fontSize: "12px",
  lineHeight: "15px",
  color: color.muted,
};
