import { parseHTML } from "linkedom";
import { FONT_STYLESHEET } from "./edition/html";
import { limits } from "./theme";
import type { BuiltEdition, EditionInput, ValidationError } from "./types";

// Mechanical validation of the output. A failure here is a template bug, not a content one.
export function validateEdition(input: EditionInput, built: BuiltEdition): ValidationError[] {
  const errors: ValidationError[] = [];
  const push = (code: ValidationError["code"], message: string, item?: number) =>
    errors.push(item === undefined ? { code, message } : { code, message, item });

  const bytes = Buffer.byteLength(built.html, "utf8");
  if (bytes > limits.htmlMaxBytes) push("html_too_large", `HTML com ${bytes} bytes, limite ${limits.htmlMaxBytes}`);
  if (built.subject.length > limits.subjectMax) push("subject_too_long", `Assunto com ${built.subject.length} caracteres`);
  if (!built.text.trim()) push("text_empty", "Texto puro vazio");

  let document: Document | undefined;
  try {
    document = parseHTML(built.html).document;
  } catch (error) {
    push("html_unparseable", `HTML não parseável: ${String(error)}`);
  }

  if (document) {
    if (document.querySelector("script")) push("script_present", "HTML contém <script>");
    for (const link of Array.from(document.querySelectorAll("link"))) {
      const href = link.getAttribute("href") ?? "";
      if (href !== FONT_STYLESHEET) push("stylesheet_not_allowed", `Folha de estilo fora da allowlist: ${href}`);
    }
    for (const img of Array.from(document.querySelectorAll("img"))) {
      const src = img.getAttribute("src") ?? "";
      if (!src.startsWith(`${input.assetBaseUrl}/`)) push("image_not_allowed", `Imagem fora de ${input.assetBaseUrl}: ${src}`);
      if (!img.getAttribute("alt")) push("image_alt_missing", `Imagem sem alt: ${src}`);
    }
    const hrefs = new Set<string>();
    for (const a of Array.from(document.querySelectorAll("a"))) {
      const href = a.getAttribute("href") ?? "";
      if (!/^https:\/\//.test(href)) push("link_not_absolute", `Link não é https absoluto: ${href || "(vazio)"}`);
      hrefs.add(href);
    }
    if (!hrefs.has(input.unsubscribeUrl)) push("unsubscribe_missing", "Sem link de descadastro no HTML");
    if (!hrefs.has(input.privacyPolicyUrl)) push("policy_link_missing", "Sem link da política de privacidade no HTML");
    if (!document.body.textContent?.includes(input.sender.postalAddress)) push("postal_address_missing", "Sem endereço postal no HTML");
    input.items.forEach((item, index) => {
      if (!hrefs.has(item.url)) push("item_link_missing_in_html", `Link ausente no HTML: ${item.url}`, index);
    });
  }

  input.items.forEach((item, index) => {
    if (item.body.length > limits.bodyMax) push("body_too_long", `Corpo com ${item.body.length} caracteres`, index);
    if (!built.text.includes(item.url)) push("item_link_missing_in_text", `Link ausente no texto: ${item.url}`, index);
  });
  if (!built.text.includes(input.unsubscribeUrl)) push("unsubscribe_missing", "Sem link de descadastro no texto");
  if (!built.text.includes(input.sender.postalAddress)) push("postal_address_missing", "Sem endereço postal no texto");

  return errors;
}
