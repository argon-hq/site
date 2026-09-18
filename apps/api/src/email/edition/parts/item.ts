import { copy } from "../../copy";
import { escapeHtml } from "../../html";
import { theme } from "../../theme";
import type { EditionItem } from "../../types";

const { font, color } = theme;

export function renderItem(item: EditionItem): string {
  return `
<tr><td class="pad dark-card" style="padding:28px 40px 24px 40px;border-bottom:1px solid ${color.border};">
  <p style="margin:0 0 8px 0;font-family:${font};font-size:10px;line-height:12px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:${color.muted};">${escapeHtml(item.category)}</p>
  <h2 class="dark-text" style="margin:0 0 8px 0;font-family:${font};font-size:18px;line-height:22px;font-weight:700;color:${color.text};">${escapeHtml(item.headline)}</h2>
  <p class="dark-muted" style="margin:0 0 8px 0;font-family:${font};font-size:13px;line-height:16px;color:${color.body};">${escapeHtml(item.body)}</p>
  <a href="${escapeHtml(item.url)}" style="font-family:${font};font-size:12px;line-height:15px;color:${color.link};text-decoration:none;">${escapeHtml(copy.item.readMore)} &rarr;</a>
</td></tr>`;
}
