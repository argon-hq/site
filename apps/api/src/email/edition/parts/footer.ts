import { copy } from "../../copy";
import { escapeHtml } from "../../html";
import { theme } from "../../theme";
import type { EditionInput } from "../../types";

const { font, color } = theme;

function renderSocial(input: EditionInput): string {
  const icons: Array<[string, string | undefined, string]> = [
    ["logo", input.social.site, copy.footer.social.site],
    ["linkedin", input.social.linkedin, copy.footer.social.linkedin],
    ["instagram", input.social.instagram, copy.footer.social.instagram],
    ["youtube", input.social.youtube, copy.footer.social.youtube],
  ];
  return icons
    .filter((icon): icon is [string, string, string] => Boolean(icon[1]))
    .map(
      ([name, url, alt]) => `
      <td style="padding:0 12px;">
        <a href="${escapeHtml(url)}" style="display:block;line-height:0;">
          <img src="${escapeHtml(input.assetBaseUrl)}/${name}.png" width="20" height="20" alt="${escapeHtml(alt)}" style="display:block;width:20px;height:20px;border:0;">
        </a>
      </td>`,
    )
    .join("");
}

export function renderFooter(input: EditionInput): string {
  const small = `margin:0 0 16px 0;font-family:${font};font-size:11px;line-height:13px;color:${color.muted};`;
  return `
<tr><td class="pad" align="center" style="padding:28px 40px;background-color:${color.dark};">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto 16px auto;"><tr>${renderSocial(input)}
  </tr></table>
  <p style="margin:0 0 16px 0;font-family:${font};font-size:14px;line-height:17px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#ffffff;">${escapeHtml(copy.brand.name)} &nbsp;&middot; ${escapeHtml(copy.brand.tagline)}</p>
  <p style="${small}">${escapeHtml(copy.footer.reason)}</p>
  <p style="${small}">${escapeHtml(input.sender.name)} &lt;${escapeHtml(input.sender.address)}&gt; &middot; ${escapeHtml(input.sender.postalAddress)}</p>
  <p style="margin:0;font-family:${font};font-size:11px;line-height:13px;color:${color.muted};"><a href="${escapeHtml(input.unsubscribeUrl)}" style="color:${color.link};text-decoration:none;">${escapeHtml(copy.footer.unsubscribe)}</a> &middot; <a href="${escapeHtml(input.privacyPolicyUrl)}" style="color:${color.link};text-decoration:none;">${escapeHtml(copy.footer.privacy)}</a></p>
</td></tr>`;
}
