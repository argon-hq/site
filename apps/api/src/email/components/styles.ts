import type { CSSProperties } from "react";
import { theme } from "../theme";

// Inline styles for the React Email tree, straight from the Figma tokens (node 6:5). Margins are
// written as longhands on purpose: the Text component emits its own margin longhands, and a
// shorthand here would not override them in every client.

const { color, font, width } = theme;

const noMargin = { marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0 } as const;
const marginBottom = (px: number): CSSProperties => ({ ...noMargin, marginBottom: `${px}px` });

export const page: CSSProperties = { ...noMargin, padding: 0, backgroundColor: color.page };

// The band behind the card, with the breathing room the prototype has around it.
export const canvas: CSSProperties = { backgroundColor: color.page, padding: "24px 12px" };

export const container: CSSProperties = {
  width: `${width}px`,
  maxWidth: `${width}px`,
  backgroundColor: color.card,
  border: `1px solid ${color.border}`,
};

export const header: CSSProperties = { padding: "24px 40px", backgroundColor: color.dark };

export const brandCell: CSSProperties = { verticalAlign: "middle" };

export const brandMark: CSSProperties = {
  width: "36px",
  height: "36px",
  borderRadius: "4px",
  backgroundColor: color.brandPlaceholder,
  fontSize: 0,
  lineHeight: 0,
};

export const brandTextCell: CSSProperties = { paddingLeft: "10px", verticalAlign: "middle" };

export const brandName: CSSProperties = {
  ...marginBottom(2),
  fontFamily: font,
  fontSize: "20px",
  lineHeight: "24px",
  fontWeight: 700,
  letterSpacing: "1px",
  textTransform: "uppercase",
  color: "#ffffff",
};

export const brandTagline: CSSProperties = {
  ...noMargin,
  fontFamily: font,
  fontSize: "9px",
  lineHeight: "11px",
  fontWeight: 700,
  letterSpacing: "2px",
  textTransform: "uppercase",
  color: color.headerMuted,
};

export const headerDate: CSSProperties = {
  verticalAlign: "middle",
  fontFamily: font,
  fontSize: "12px",
  lineHeight: "15px",
  color: color.headerMuted,
};

export const signoff: CSSProperties = { padding: "28px 40px", borderBottom: `1px solid ${color.border}` };

export const signoffLine: CSSProperties = {
  ...marginBottom(6),
  fontFamily: font,
  fontSize: "14px",
  lineHeight: "17px",
  color: color.signoff,
};

export const signoffSignature: CSSProperties = {
  ...noMargin,
  fontFamily: font,
  fontSize: "15px",
  lineHeight: "18px",
  fontWeight: 700,
  color: color.text,
};

export const footer: CSSProperties = { padding: "28px 40px", backgroundColor: color.dark, textAlign: "center" };

export const socialRow: CSSProperties = { ...marginBottom(16) };

export const socialLink: CSSProperties = { display: "inline-block", padding: "0 12px", lineHeight: 0 };

export const socialIcon: CSSProperties = { display: "block", width: "20px", height: "20px", border: 0 };

export const footerBrand: CSSProperties = {
  ...marginBottom(16),
  fontFamily: font,
  fontSize: "14px",
  lineHeight: "17px",
  fontWeight: 700,
  letterSpacing: "2px",
  textTransform: "uppercase",
  color: "#ffffff",
};

export const footerSmall: CSSProperties = {
  ...marginBottom(16),
  fontFamily: font,
  fontSize: "11px",
  lineHeight: "13px",
  color: color.muted,
};

export const footerLinks: CSSProperties = {
  ...noMargin,
  fontFamily: font,
  fontSize: "11px",
  lineHeight: "13px",
  color: color.muted,
};

export const footerLink: CSSProperties = { color: color.link, textDecoration: "none" };

// What inline styles cannot express: the narrow breakpoint and dark mode. Outlook (app and web)
// ignores the media query and flips colors by itself, so it gets the data-ogsc/data-ogsb hooks.
export const HEAD_CSS = `
  @media only screen and (max-width: 620px) {
    .container { width: 100% !important; }
    .pad { padding-left: 20px !important; padding-right: 20px !important; }
  }
  @media (prefers-color-scheme: dark) {
    .dark-bg { background-color: #0f0f10 !important; }
    .dark-card { background-color: #1f1f21 !important; border-color: #333333 !important; }
    .dark-text { color: #f2f2f2 !important; }
    .dark-muted { color: #c8c8c8 !important; }
  }
  [data-ogsb] .dark-bg { background-color: #0f0f10 !important; }
  [data-ogsb] .dark-card { background-color: #1f1f21 !important; border-color: #333333 !important; }
  [data-ogsc] .dark-text { color: #f2f2f2 !important; }
  [data-ogsc] .dark-muted { color: #c8c8c8 !important; }
`;
