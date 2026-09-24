import { Effect } from "effect";
import { parseHTML } from "linkedom";
import { EditionInvalidError, HtmlParseError } from "./errors";
import { FONT_STYLESHEET, limits } from "./theme";
import type { BuiltEdition, EditionInput, ValidationError } from "./types";

// Mechanical validation of the output. A failure here is a template bug, not a content one.

const error = (code: ValidationError["code"], message: string, item?: number): ValidationError =>
  item === undefined ? { code, message } : { code, message, item };

// Size and emptiness, the checks that need neither the DOM nor the items.
function shapeErrors(built: BuiltEdition): ValidationError[] {
  const errors: ValidationError[] = [];
  const bytes = Buffer.byteLength(built.html, "utf8");
  if (bytes > limits.htmlMaxBytes) errors.push(error("html_too_large", `HTML is ${bytes} bytes, the limit is ${limits.htmlMaxBytes}`));
  if (built.subject.length > limits.subjectMax) errors.push(error("subject_too_long", `subject is ${built.subject.length} characters long`));
  if (!built.text.trim()) errors.push(error("text_empty", "plain text is empty"));
  return errors;
}

// What only the rendered DOM can answer: no scripts, stylesheets and images on the allowlist,
// every link absolute, and the links the law requires actually present.
function documentErrors(input: EditionInput, document: Document): ValidationError[] {
  const errors: ValidationError[] = [];
  if (document.querySelector("script")) errors.push(error("script_present", "HTML contains <script>"));

  for (const link of Array.from(document.querySelectorAll("link"))) {
    const href = link.getAttribute("href") ?? "";
    if (href !== FONT_STYLESHEET) errors.push(error("stylesheet_not_allowed", `stylesheet outside the allowlist: ${href}`));
  }

  // https like every link: an image over plain http is refused or left unloaded by mail clients,
  // and a redirect to https does not save it — the box arrives empty and the e-mail looks broken.
  for (const img of Array.from(document.querySelectorAll("img"))) {
    const src = img.getAttribute("src") ?? "";
    if (!/^https:\/\//.test(src)) errors.push(error("image_not_absolute", `image is not an absolute https URL: ${src || "(empty)"}`));
    if (!src.startsWith(`${input.assetBaseUrl}/`)) errors.push(error("image_not_allowed", `image outside ${input.assetBaseUrl}: ${src}`));
    if (!img.getAttribute("alt")) errors.push(error("image_alt_missing", `image without alt: ${src}`));
  }

  const hrefs = new Set<string>();
  for (const anchor of Array.from(document.querySelectorAll("a"))) {
    const href = anchor.getAttribute("href") ?? "";
    if (!/^https:\/\//.test(href)) errors.push(error("link_not_absolute", `link is not an absolute https URL: ${href || "(empty)"}`));
    hrefs.add(href);
  }

  if (!hrefs.has(input.unsubscribeUrl)) errors.push(error("unsubscribe_missing", "no unsubscribe link in the HTML"));
  if (!hrefs.has(input.privacyPolicyUrl)) errors.push(error("policy_link_missing", "no privacy policy link in the HTML"));
  if (!document.body.textContent?.includes(input.sender.postalAddress)) {
    errors.push(error("postal_address_missing", "no postal address in the HTML"));
  }
  input.items.forEach((item, index) => {
    if (!hrefs.has(item.url)) errors.push(error("item_link_missing_in_html", `link missing from the HTML: ${item.url}`, index));
  });

  return errors;
}

// The plain-text part carries the same duties as the HTML one.
function textErrors(input: EditionInput, built: BuiltEdition): ValidationError[] {
  const errors: ValidationError[] = [];
  input.items.forEach((item, index) => {
    if (item.body.length > limits.bodyMax) errors.push(error("body_too_long", `body is ${item.body.length} characters long`, index));
    if (!built.text.includes(item.url)) errors.push(error("item_link_missing_in_text", `link missing from the text: ${item.url}`, index));
  });
  if (!built.text.includes(input.unsubscribeUrl)) errors.push(error("unsubscribe_missing", "no unsubscribe link in the text"));
  if (!built.text.includes(input.sender.postalAddress)) errors.push(error("postal_address_missing", "no postal address in the text"));
  return errors;
}

const parseDocument = (html: string) =>
  Effect.try({ try: () => parseHTML(html).document, catch: (cause) => new HtmlParseError({ cause }) });

// Collects every error before failing: one report tells the whole story, one run tells it once.
export function collectEditionErrors(input: EditionInput, built: BuiltEdition): Effect.Effect<ValidationError[]> {
  return parseDocument(built.html).pipe(
    Effect.map((document) => documentErrors(input, document)),
    Effect.catchTag("HtmlParseError", (failure) =>
      Effect.succeed([error("html_unparseable", `HTML could not be parsed: ${String(failure.cause)}`)]),
    ),
    Effect.map((htmlErrors) => [...shapeErrors(built), ...htmlErrors, ...textErrors(input, built)]),
  );
}

// The pipeline calls this one: the built edition comes back untouched, or the run fails typed.
export function validateEdition(input: EditionInput, built: BuiltEdition): Effect.Effect<BuiltEdition, EditionInvalidError> {
  return collectEditionErrors(input, built).pipe(
    Effect.flatMap((errors) => (errors.length > 0 ? Effect.fail(new EditionInvalidError({ errors })) : Effect.succeed(built))),
  );
}
