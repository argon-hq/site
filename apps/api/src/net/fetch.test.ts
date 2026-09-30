import { describe, expect, it } from "vitest";
import { charsetOf, decode } from "./fetch";

const latin1 = (text: string) => new Uint8Array(Buffer.from(text, "latin1"));

describe("charsetOf", () => {
  it("trusts the header first", () => {
    expect(charsetOf("application/rss+xml; charset=ISO-8859-1", latin1("<?xml version='1.0'?>"))).toBe("iso-8859-1");
  });

  it("reads the XML prolog when the header says nothing, as Folha's feed does", () => {
    expect(charsetOf("text/xml", latin1('<?xml version="1.0" encoding="ISO-8859-1" ?><rss/>'))).toBe("iso-8859-1");
  });

  it("reads a meta charset in a page", () => {
    expect(charsetOf(null, latin1('<html><head><meta charset="windows-1252"></head>'))).toBe("windows-1252");
  });

  it("defaults to UTF-8", () => {
    expect(charsetOf(null, latin1("<rss/>"))).toBe("utf-8");
  });
});

describe("decode", () => {
  it("keeps the accents of a Latin-1 feed", () => {
    expect(decode(latin1("negócio, caminhões"), "iso-8859-1")).toBe("negócio, caminhões");
  });

  it("reads an unknown label as UTF-8 instead of failing the address", () => {
    expect(decode(new TextEncoder().encode("ação"), "x-unknown")).toBe("ação");
  });
});
