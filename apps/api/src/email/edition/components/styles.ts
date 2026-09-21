import type { CSSProperties } from "react";
import { theme } from "../../theme";

// Styles of the news item, the only piece of the layout that belongs to the edition. Everything
// the other templates also use lives in `email/components/styles.ts`.

const { color, font } = theme;

const noMargin = { marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0 } as const;
const marginBottom = (px: number): CSSProperties => ({ ...noMargin, marginBottom: `${px}px` });

export const item: CSSProperties = { padding: "28px 40px 24px 40px", borderBottom: `1px solid ${color.border}` };

export const itemCategory: CSSProperties = {
  ...marginBottom(8),
  fontFamily: font,
  fontSize: "10px",
  lineHeight: "12px",
  fontWeight: 600,
  letterSpacing: "1px",
  textTransform: "uppercase",
  color: color.muted,
};

export const itemHeadline: CSSProperties = {
  ...marginBottom(8),
  fontFamily: font,
  fontSize: "18px",
  lineHeight: "22px",
  fontWeight: 700,
  color: color.text,
};

export const itemBody: CSSProperties = {
  ...marginBottom(8),
  fontFamily: font,
  fontSize: "13px",
  lineHeight: "16px",
  color: color.body,
};

export const itemLink: CSSProperties = {
  fontFamily: font,
  fontSize: "12px",
  lineHeight: "15px",
  color: color.link,
  textDecoration: "none",
};

