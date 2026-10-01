import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { charsetOf, decode, guardedLookup, liveDeps } from "./fetch";

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

describe("guardedLookup", () => {
  const lookupWith = (addresses: { address: string; family: number }[] | Error, all = false) =>
    new Promise<{ error: NodeJS.ErrnoException | null; result: unknown }>((resolve) => {
      const resolver = () => (addresses instanceof Error ? Promise.reject(addresses) : Promise.resolve(addresses));
      guardedLookup(resolver)("fonte.test", { all }, (error, address, family) =>
        resolve({ error, result: all ? address : { address, family } }),
      );
    });

  it("connects to the public address it checked", async () => {
    const { error, result } = await lookupWith([{ address: "200.1.2.3", family: 4 }]);
    expect(error).toBeNull();
    expect(result).toEqual({ address: "200.1.2.3", family: 4 });
  });

  it("hands every address when the socket asks for all of them", async () => {
    const addresses = [
      { address: "200.1.2.3", family: 4 },
      { address: "2001:db8::1", family: 6 },
    ];
    expect((await lookupWith(addresses, true)).result).toEqual(addresses);
  });

  it("refuses a name with any private address, which is what a rebinding answer looks like", async () => {
    const { error } = await lookupWith([
      { address: "200.1.2.3", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ]);
    expect(error?.message).toMatch(/private address/);
  });

  it("passes on a resolver failure", async () => {
    const { error } = await lookupWith(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }));
    expect(error?.message).toBe("ENOTFOUND");
  });
});

describe("the live fetch", () => {
  it("refuses at connection time a name that resolves inside the machine, whatever was checked before", async () => {
    const server = createServer((_req, res) => res.end("inside"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      // `localhost` is 127.0.0.1: no guardUrl here, only the agent stands between the fetch and it.
      await expect(liveDeps.fetch(`http://localhost:${port}/`)).rejects.toThrow();
    } finally {
      server.close();
    }
  });
});
