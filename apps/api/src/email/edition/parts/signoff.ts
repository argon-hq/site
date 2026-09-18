import { copy } from "../../copy";
import { escapeHtml } from "../../html";
import { theme } from "../../theme";

const { font, color } = theme;

export function renderSignoff(): string {
  return `
<tr><td class="pad dark-card" style="padding:28px 40px;border-bottom:1px solid ${color.border};">
  <p class="dark-muted" style="margin:0 0 6px 0;font-family:${font};font-size:14px;line-height:17px;color:${color.signoff};">${escapeHtml(copy.signoff.line)}</p>
  <p class="dark-text" style="margin:0;font-family:${font};font-size:15px;line-height:18px;font-weight:700;color:${color.text};">${escapeHtml(copy.signoff.signature)}</p>
</td></tr>`;
}
