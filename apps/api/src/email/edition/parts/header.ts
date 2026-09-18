import { copy } from "../../copy";
import { escapeHtml } from "../../html";
import { theme } from "../../theme";

const { font, color } = theme;

export function renderHeader(dateLabel: string): string {
  return `
<tr><td class="pad" style="padding:24px 40px;background-color:${color.dark};">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
    <td style="vertical-align:middle;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
        <td style="width:36px;height:36px;border-radius:4px;background-color:${color.brandPlaceholder};font-size:0;line-height:0;">&nbsp;</td>
        <td style="padding-left:10px;vertical-align:middle;">
          <p style="margin:0 0 2px 0;font-family:${font};font-size:20px;line-height:24px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#ffffff;">${escapeHtml(copy.brand.name)}</p>
          <p style="margin:0;font-family:${font};font-size:9px;line-height:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${color.headerMuted};">${escapeHtml(copy.brand.tagline)}</p>
        </td>
      </tr></table>
    </td>
    <td align="right" style="vertical-align:middle;font-family:${font};font-size:12px;line-height:15px;color:${color.headerMuted};">${escapeHtml(copy.header.edition)} &middot; ${escapeHtml(dateLabel)}</td>
  </tr></table>
</td></tr>`;
}
