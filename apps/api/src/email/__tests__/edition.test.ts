import { describe, expect, it } from "vitest";
import { buildEdition } from "../edition/build";
import { editionFixture } from "../fixtures/edition";
import { editionEdgeFixture } from "../fixtures/edition-edge";
import { TEXT_WIDTH, wrap } from "../edition/text";
import { limits } from "../theme";
import type { EditionInput } from "../types";
import { validateEdition } from "../validate";

const codes = (input: EditionInput) => validateEdition(input, buildEdition(input)).map((e) => e.code);

describe("buildEdition", () => {
  it("is pure: same input, same output", () => {
    expect(buildEdition(editionFixture)).toEqual(buildEdition(editionFixture));
  });

  it("reproduces the fixture HTML", () => {
    expect(buildEdition(editionFixture).html).toMatchSnapshot();
  });

  it("reproduces the fixture plain text", () => {
    expect(buildEdition(editionFixture).text).toMatchSnapshot();
  });

  it("reproduces the edge-case HTML", () => {
    expect(buildEdition(editionEdgeFixture).html).toMatchSnapshot();
  });

  it("escapes content that comes from the model", () => {
    const input = { ...editionFixture, items: [{ ...editionFixture.items[0], headline: '<script>alert("x")</script> & "aspas"' }] };
    const { html } = buildEdition(input);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;aspas&quot;");
  });

  it("stays under 100 KB with six items", () => {
    const input = { ...editionFixture, items: [...editionFixture.items, editionFixture.items[0]] };
    expect(Buffer.byteLength(buildEdition(input).html)).toBeLessThan(limits.htmlMaxBytes);
  });

  it("omits a social icon without URL", () => {
    const input = { ...editionFixture, social: { site: editionFixture.social.site } };
    const { html } = buildEdition(input);
    expect(html).toContain("logo.png");
    expect(html).not.toContain("linkedin.png");
  });
});

describe("renderText", () => {
  it("wraps prose at 78 columns and keeps lines with a URL", () => {
    const { text } = buildEdition(editionFixture);
    for (const line of text.split("\n")) {
      if (!/https?:\/\//.test(line)) expect(line.length).toBeLessThanOrEqual(TEXT_WIDTH);
    }
    expect(text).toContain(editionFixture.items[0].url);
  });

  it("does not split words", () => {
    expect(wrap("aa bb cc", 5)).toEqual(["aa bb", "cc"]);
  });
});

describe("validateEdition", () => {
  it("accepts the fixture", () => {
    expect(codes(editionFixture)).toEqual([]);
  });

  it("accepts the edge cases, which sit exactly on the limits", () => {
    expect(editionEdgeFixture.subject.length).toBe(limits.subjectMax);
    expect(editionEdgeFixture.items[0].body.length).toBe(limits.bodyMax);
    expect(codes(editionEdgeFixture)).toEqual([]);
  });

  it("reports a body over the limit with the item index", () => {
    const input = { ...editionFixture, items: [{ ...editionFixture.items[0], body: "x".repeat(limits.bodyMax + 1) }] };
    expect(validateEdition(input, buildEdition(input))).toEqual([
      expect.objectContaining({ code: "body_too_long", item: 0 }),
    ]);
  });

  it("reports a link that is not absolute https", () => {
    const input = { ...editionFixture, items: [{ ...editionFixture.items[0], url: "http://example.com/x" }] };
    expect(codes(input)).toEqual(["link_not_absolute"]);
  });

  it("reports a subject over the limit", () => {
    expect(codes({ ...editionFixture, subject: "x".repeat(limits.subjectMax + 1) })).toEqual(["subject_too_long"]);
  });

  it("reports script, image outside the allowlist and missing links in tampered HTML", () => {
    const built = buildEdition(editionFixture);
    const tampered = {
      ...built,
      html: built.html
        .replace("</body>", '<script>1</script><img src="https://evil.example/x.png"></body>')
        .replaceAll(editionFixture.unsubscribeUrl, "https://other.example/unsub")
        .replaceAll(editionFixture.items[2].url, "https://other.example/3"),
      text: built.text.replaceAll(editionFixture.sender.postalAddress, ""),
    };
    const result = validateEdition(editionFixture, tampered).map((e) => e.code);
    expect(result).toEqual(
      expect.arrayContaining(["script_present", "image_not_allowed", "image_alt_missing", "unsubscribe_missing", "item_link_missing_in_html", "postal_address_missing"]),
    );
    expect(result).not.toContain("html_unparseable");
  });
});
