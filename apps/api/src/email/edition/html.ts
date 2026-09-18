import { escapeHtml, formatDate } from "../html";
import { theme } from "../theme";
import type { EditionInput } from "../types";
import { renderFooter } from "./parts/footer";
import { renderHeader } from "./parts/header";
import { renderItem } from "./parts/item";
import { renderSignoff } from "./parts/signoff";

// The one external stylesheet allowed. Clients that do not load it fall back to the font stack.
export const FONT_STYLESHEET = "https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap";

const { width, color } = theme;

// Keeps the body text out of the inbox preview after the preheader.
const PREHEADER_PADDING = "&zwnj;&nbsp;".repeat(60);

export function renderHtml(input: EditionInput): string {
  const dateLabel = formatDate(input.date);
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(input.subject)}</title>
<!--[if !mso]><!--><link href="${FONT_STYLESHEET}" rel="stylesheet"><!--<![endif]-->
<!--[if mso]><style>table, td, p, h2, a { font-family: Arial, Helvetica, sans-serif !important; }</style><![endif]-->
<style>
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
  /* Outlook (app and web) uses data-ogsc/data-ogsb instead of the media query. */
  [data-ogsb] .dark-bg { background-color: #0f0f10 !important; }
  [data-ogsb] .dark-card { background-color: #1f1f21 !important; border-color: #333333 !important; }
  [data-ogsc] .dark-text { color: #f2f2f2 !important; }
  [data-ogsc] .dark-muted { color: #c8c8c8 !important; }
</style>
</head>
<body class="dark-bg" style="margin:0;padding:0;background-color:${color.page};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(input.title)}${PREHEADER_PADDING}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" class="dark-bg" style="background-color:${color.page};">
<tr><td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" width="${width}" cellspacing="0" cellpadding="0" border="0" align="center"><tr><td><![endif]-->
<table role="presentation" width="${width}" cellspacing="0" cellpadding="0" border="0" class="container" style="width:${width}px;max-width:${width}px;background-color:${color.card};border:1px solid ${color.border};">
${renderHeader(dateLabel)}
${input.items.map(renderItem).join("")}
${renderSignoff()}
${renderFooter(input)}
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}
