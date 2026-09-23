import { Effect, Either } from "effect";
import { describe, expect, it } from "vitest";
import { buildEdition } from "../edition/build";
import { TEXT_WIDTH, wrap } from "../text";
import { EditionInvalidError } from "../errors";
import { editionEdgeFixture } from "../fixtures/edition-edge";
import { editionFixture } from "../fixtures/edition";
import { limits } from "../theme";
import type { EditionInput } from "../types";
import { collectEditionErrors, validateEdition } from "../validate";

const build = (input: EditionInput) => Effect.runPromise(buildEdition(input));

const codes = async (input: EditionInput) => {
  const built = await build(input);
  const errors = await Effect.runPromise(collectEditionErrors(input, built));
  return errors.map((e) => e.code);
};

describe("buildEdition", () => {
  it("is deterministic: same input, same output", async () => {
    expect(await build(editionFixture)).toEqual(await build(editionFixture));
  });

  it("reproduces the fixture HTML", async () => {
    expect((await build(editionFixture)).html).toMatchSnapshot();
  });

  it("reproduces the fixture plain text", async () => {
    expect((await build(editionFixture)).text).toMatchSnapshot();
  });

  it("reproduces the edge-case HTML", async () => {
    expect((await build(editionEdgeFixture)).html).toMatchSnapshot();
  });

  it("escapes content that comes from the model", async () => {
    const input = { ...editionFixture, items: [{ ...editionFixture.items[0], headline: '<script>alert("x")</script> & "aspas"' }] };
    const { html } = await build(input);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;aspas&quot;");
  });

  it("stays under 100 KB with six items", async () => {
    const input = { ...editionFixture, items: [...editionFixture.items, editionFixture.items[0]] };
    expect(Buffer.byteLength((await build(input)).html)).toBeLessThan(limits.htmlMaxBytes);
  });

  it("omits a social icon without URL", async () => {
    const input = { ...editionFixture, social: { site: editionFixture.social.site } };
    const { html } = await build(input);
    expect(html).toContain("logo.png");
    expect(html).not.toContain("linkedin.png");
  });
});

describe("renderText", () => {
  it("wraps prose at 78 columns and keeps lines with a URL", async () => {
    const { text } = await build(editionFixture);
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
  it("accepts the fixture and hands the built edition back", async () => {
    const built = await build(editionFixture);
    expect(await Effect.runPromise(validateEdition(editionFixture, built))).toBe(built);
  });

  it("accepts the edge cases, which sit exactly on the limits", async () => {
    expect(editionEdgeFixture.subject.length).toBe(limits.subjectMax);
    expect(editionEdgeFixture.items[0].body.length).toBe(limits.bodyMax);
    expect(await codes(editionEdgeFixture)).toEqual([]);
  });

  it("fails with a typed error carrying every problem", async () => {
    const input = { ...editionFixture, items: [{ ...editionFixture.items[0], body: "x".repeat(limits.bodyMax + 1) }] };
    const built = await build(input);
    const result = await Effect.runPromise(Effect.either(validateEdition(input, built)));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(EditionInvalidError);
      expect(result.left._tag).toBe("EditionInvalidError");
      expect(result.left.errors).toEqual([expect.objectContaining({ code: "body_too_long", item: 0 })]);
    }
  });

  it("reports a link that is not absolute https", async () => {
    const input = { ...editionFixture, items: [{ ...editionFixture.items[0], url: "http://example.com/x" }] };
    expect(await codes(input)).toEqual(["link_not_absolute"]);
  });

  // The lab failure of 23/09: the base of the images was typed by hand into the settings as http,
  // the site answered 308 to https, and the icons arrived as empty boxes. The prefix check alone
  // said nothing, because the src did start with the base it was given.
  it("reports an image that is not https, even when it is under the allowed base", async () => {
    const overHttp = { ...editionFixture, assetBaseUrl: "http://lab.argon.com.br/email" };
    const result = await codes(overHttp);

    // One per icon in the footer, and nothing else: the src is under the base it was given.
    expect(new Set(result)).toEqual(new Set(["image_not_absolute"]));
    expect(result).toHaveLength(4);
  });

  it("reports a subject over the limit", async () => {
    expect(await codes({ ...editionFixture, subject: "x".repeat(limits.subjectMax + 1) })).toEqual(["subject_too_long"]);
  });

  it("reports script, image outside the allowlist and missing links in tampered HTML", async () => {
    const built = await build(editionFixture);
    const tampered = {
      ...built,
      html: built.html
        .replace("</body>", '<script>1</script><img src="https://evil.example/x.png"></body>')
        .replaceAll(editionFixture.unsubscribeUrl, "https://other.example/unsub")
        .replaceAll(editionFixture.items[2].url, "https://other.example/3"),
      text: built.text.replaceAll(editionFixture.sender.postalAddress, ""),
    };
    const errors = await Effect.runPromise(collectEditionErrors(editionFixture, tampered));
    const result = errors.map((e) => e.code);

    expect(result).toEqual(
      expect.arrayContaining([
        "script_present",
        "image_not_allowed",
        "image_alt_missing",
        "unsubscribe_missing",
        "item_link_missing_in_html",
        "postal_address_missing",
      ]),
    );
    expect(result).not.toContain("html_unparseable");
  });
});
