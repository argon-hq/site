import type { CSSProperties } from "react";
import { theme } from "../theme";

// Inline styles for the React Email tree, from the brand tokens in ../theme. Margins are
// written as longhands on purpose: the Text component emits its own margin longhands, and a
// shorthand here would not override them in every client.

const { color, font, mono, width } = theme;

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

// The lilac rule under the band is the one accent of the header.
export const header: CSSProperties = {
  padding: "24px 40px",
  backgroundColor: color.dark,
  borderBottom: `2px solid ${color.linkOnDark}`,
};

export const brandCell: CSSProperties = { verticalAlign: "middle" };

// The symbol takes the height of both lines; the name and the tagline stack beside it.
export const brandMarkCell: CSSProperties = { width: "40px", verticalAlign: "middle" };

export const brandMark: CSSProperties = { display: "block", width: "40px", height: "40px", border: 0 };

export const brandTextCell: CSSProperties = { paddingLeft: "12px", verticalAlign: "middle" };

// The drawn ARGON, 120×20 on screen from a 2x PNG. The alt text is what a client that blocks
// images shows in its place.
export const brandName: CSSProperties = { display: "block", width: "120px", height: "20px", border: 0 };

export const brandTagline: CSSProperties = {
  ...noMargin,
  marginTop: "6px",
  fontFamily: mono,
  fontSize: "10px",
  lineHeight: "12px",
  letterSpacing: "1.5px",
  textTransform: "uppercase",
  color: color.headerMuted,
};

export const headerDate: CSSProperties = {
  verticalAlign: "middle",
  fontFamily: mono,
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
  fontFamily: mono,
  fontSize: "12px",
  lineHeight: "15px",
  fontWeight: 500,
  letterSpacing: "2px",
  textTransform: "uppercase",
  color: "#ffffff",
};

export const footerSmall: CSSProperties = {
  ...marginBottom(16),
  fontFamily: font,
  fontSize: "11px",
  lineHeight: "13px",
  color: color.headerMuted,
};

export const footerLinks: CSSProperties = {
  ...noMargin,
  fontFamily: font,
  fontSize: "11px",
  lineHeight: "13px",
  color: color.headerMuted,
};

export const footerLink: CSSProperties = { color: color.linkOnDark, textDecoration: "none" };

// What inline styles cannot express: the narrow breakpoint and dark mode. Outlook (app and web)
// ignores the media query and flips colors by itself, so it gets the data-ogsc/data-ogsb hooks.
export const HEAD_CSS = `
  @media only screen and (max-width: 620px) {
    .container { width: 100% !important; }
    .pad { padding-left: 20px !important; padding-right: 20px !important; }
  }
  @media (prefers-color-scheme: dark) {
    .dark-bg { background-color: #0b0a10 !important; }
    .dark-card { background-color: #1b1824 !important; border-color: #2d2a38 !important; }
    .dark-text { color: #ecebf4 !important; }
    .dark-muted { color: #c3c0d0 !important; }
  }
  [data-ogsb] .dark-bg { background-color: #0b0a10 !important; }
  [data-ogsb] .dark-card { background-color: #1b1824 !important; border-color: #2d2a38 !important; }
  [data-ogsc] .dark-text { color: #ecebf4 !important; }
  [data-ogsc] .dark-muted { color: #c3c0d0 !important; }
`;
