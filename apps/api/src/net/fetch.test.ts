import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Effect } from "effect";
import {
  charsetOf,
  decode,
  describeError,
  fetchBody,
  guardedLookup,
  isPublicAddress,
  liveDeps,
  type BodyRequest,
  type FetchDeps,
} from "./fetch";

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

describe("isPublicAddress", () => {
  it("refuses loopback, link-local, private and mapped addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "169.254.169.254",
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fe80::1",
      "fd00::1",
      "::ffff:169.254.169.254",
      // The metadata service in the hex spelling of an IPv4-mapped address, and inside NAT64 and 6to4.
      "::ffff:a9fe:a9fe",
      "64:ff9b::a9fe:a9fe",
      "2002:a9fe:a9fe::1",
      // The rest of the link-local block, documentation, benchmarking, multicast and reserved.
      "febf::1",
      "2001:db8::1",
      "192.0.2.10",
      "203.0.113.10",
      "198.18.0.1",
      "224.0.0.1",
      "255.255.255.255",
      "not an ip",
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });

  it("accepts public addresses", () => {
    for (const ip of ["200.1.2.3", "8.8.8.8", "172.32.0.1", "2804:14c::1", "::ffff:8.8.8.8", "::ffff:808:808"]) {
      expect(isPublicAddress(ip), ip).toBe(true);
    }
  });
});

describe("guardedLookup", () => {
  type Options = { all?: boolean; family?: number };
  const lookupWith = (addresses: { address: string; family: number }[] | Error, options: Options = {}) =>
    new Promise<{ error: NodeJS.ErrnoException | null; result: unknown }>((resolve) => {
      const resolver = () => (addresses instanceof Error ? Promise.reject(addresses) : Promise.resolve(addresses));
      guardedLookup(resolver)("fonte.test", options, (error, address, family) =>
        resolve({ error, result: options.all ? address : { address, family } }),
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
      { address: "2804:14c::1", family: 6 },
    ];
    expect((await lookupWith(addresses, { all: true })).result).toEqual(addresses);
  });

  it("answers in the family the socket asked for, and fails when the name has none of it", async () => {
    const addresses = [
      { address: "2804:14c::1", family: 6 },
      { address: "200.1.2.3", family: 4 },
    ];
    expect((await lookupWith(addresses, { family: 4 })).result).toEqual({ address: "200.1.2.3", family: 4 });
    expect((await lookupWith(addresses, { all: true, family: 6 })).result).toEqual([addresses[0]]);
    expect((await lookupWith([addresses[1] as never], { family: 6 })).error?.code).toBe("ENOTFOUND");
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
      const init = { headers: {}, signal: new AbortController().signal, redirect: "manual" as const };
      await expect(liveDeps.fetch(`http://localhost:${port}/`, init)).rejects.toThrow();
    } finally {
      server.close();
    }
  });
});

describe("describeError", () => {
  it("brings the cause of a network error to the reason, not only undici's 'fetch failed'", () => {
    const cause = Object.assign(new Error("connect ECONNREFUSED 200.1.2.3:443"), { code: "ECONNREFUSED" });
    expect(describeError(new TypeError("fetch failed", { cause }))).toBe(
      "fetch failed: connect ECONNREFUSED 200.1.2.3:443",
    );
    const refused = Object.assign(new Error("fonte.test resolves to a private address"), { code: "EADDRNOTAVAIL" });
    expect(describeError(new TypeError("fetch failed", { cause: refused }))).toBe(
      "fetch failed: fonte.test resolves to a private address (EADDRNOTAVAIL)",
    );
    expect(describeError("plain")).toBe("plain");
  });
});

describe("charsetOf, with a byte order mark", () => {
  it("trusts the mark over the header and the prolog", () => {
    expect(charsetOf("text/xml; charset=iso-8859-1", new Uint8Array([0xef, 0xbb, 0xbf, 0x3c]))).toBe("utf-8");
    expect(charsetOf(null, new Uint8Array([0xff, 0xfe, 0x3c, 0x00]))).toBe("utf-16le");
    expect(charsetOf(null, new Uint8Array([0xfe, 0xff, 0x00, 0x3c]))).toBe("utf-16be");
  });

  it("decodes a UTF-16 feed and drops the mark", () => {
    const bytes = new Uint8Array([0xff, 0xfe, ...Buffer.from("<rss>ação</rss>", "utf16le")]);
    expect(decode(bytes, charsetOf(null, bytes))).toBe("<rss>ação</rss>");
  });
});

describe("fetchBody", () => {
  const answer = (body: string, headers: Record<string, string> = {}, status = 200): FetchDeps => ({
    resolve: async () => [{ address: "200.1.2.3", family: 4 }],
    fetch: async () => new Response(body, { status, headers: { "content-type": "application/xml", ...headers } }),
  });
  const request = (deps: FetchDeps, over: Partial<BodyRequest> = {}): BodyRequest => ({
    allowed: () => true,
    deps,
    accept: "application/xml",
    maxBytes: 1_000,
    overflow: "fail",
    timeout: "5 seconds",
    ...over,
  });
  const run = (deps: FetchDeps, over?: Partial<BodyRequest>) =>
    Effect.runPromise(Effect.either(fetchBody("https://fonte.test/feed", request(deps, over))));

  it("reads, decodes and reports the charset and the size", async () => {
    const result = await run(answer("<rss>ação</rss>", { "content-type": "application/xml; charset=utf-8" }));
    expect(result).toMatchObject({ _tag: "Right", right: { text: "<rss>ação</rss>", charset: "utf-8", status: 200 } });
  });

  it("fails a body over the limit when cutting would break it, and cuts it when asked", async () => {
    const big = answer("x".repeat(2_000));
    expect(await run(big)).toMatchObject({ _tag: "Left", left: { _tag: "BodyTooLarge" } });
    const cut = await run(big, { overflow: "cut" });
    expect(cut._tag === "Right" && cut.right.bytes).toBe(1_000);
  });

  it("fails a status that is not 2xx with the status, and an unexpected type before reading", async () => {
    expect(await run(answer("gone", {}, 404))).toMatchObject({
      _tag: "Left",
      left: { _tag: "FetchFailed", status: 404 },
    });
    expect(await run(answer("%PDF", { "content-type": "application/pdf" }), { types: /xml/ })).toMatchObject({
      _tag: "Left",
      left: { _tag: "UnexpectedType" },
    });
  });

  it("refuses credentials in the address before resolving or fetching anything", async () => {
    const calls: string[] = [];
    const spy: FetchDeps = {
      resolve: async (hostname) => {
        calls.push(`resolve ${hostname}`);
        return [{ address: "200.1.2.3", family: 4 }];
      },
      fetch: async (url) => {
        calls.push(`fetch ${url}`);
        return new Response("", { status: 200 });
      },
    };
    const result = await Effect.runPromise(Effect.either(fetchBody("https://user:pw@fonte.test/feed", request(spy))));
    expect(result).toMatchObject({ _tag: "Left", left: { _tag: "UrlNotAllowed", reason: "credentials in the url" } });
    expect(calls).toEqual([]);
  });

  it("fails a redirect to a location that is no address, instead of crashing", async () => {
    const result = await run(answer("", { location: "http://[" }, 302));
    expect(result).toMatchObject({ _tag: "Left", left: { _tag: "FetchFailed", status: 302 } });
    expect(result._tag === "Left" && result.left.reason).toMatch(/invalid location/);
  });

  it("carries the cause of a resolver or a network failure in the reason", async () => {
    const noName: FetchDeps = { ...answer(""), resolve: () => Promise.reject(new Error("getaddrinfo ENOTFOUND")) };
    expect(await run(noName)).toMatchObject({
      _tag: "Left",
      left: { _tag: "UrlNotAllowed", reason: "dns: getaddrinfo ENOTFOUND" },
    });

    const cause = Object.assign(new Error("connect ECONNRESET"), { code: "ECONNRESET" });
    const reset: FetchDeps = { ...answer(""), fetch: () => Promise.reject(new TypeError("fetch failed", { cause })) };
    expect(await run(reset)).toMatchObject({
      _tag: "Left",
      left: { _tag: "FetchFailed", reason: "fetch failed: connect ECONNRESET" },
    });
  });

  it("fails a body whose stream breaks half-way", async () => {
    const broken = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("socket hang up"));
      },
    });
    const deps: FetchDeps = { ...answer(""), fetch: async () => new Response(broken, { status: 200 }) };
    expect(await run(deps)).toMatchObject({ _tag: "Left", left: { _tag: "FetchFailed", reason: "socket hang up" } });
  });

  it("aborts the request at the deadline", async () => {
    let aborted = false;
    const slow: FetchDeps = {
      resolve: async () => [{ address: "200.1.2.3", family: 4 }],
      fetch: (_url, init) =>
        new Promise((_resolve, reject) =>
          init.signal.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("aborted"));
          }),
        ),
    };
    expect(await run(slow, { timeout: "50 millis" })).toMatchObject({ _tag: "Left", left: { reason: "timeout" } });
    expect(aborted).toBe(true);
  });
});
