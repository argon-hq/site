import { Data, Duration, Effect } from "effect";
import type { LookupOptions } from "node:dns";
import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

// The one way the API reads the web: a feed at ingestion, a page for the agent. Both go through the
// same checks — only the sources, only http(s), never an address inside the machine's own network —
// on the address asked for, on every redirect it is sent through, and again on the address the
// socket actually connects to. A feed or a page can point anywhere; this is what keeps "anywhere"
// from being the instance metadata.

export const USER_AGENT = "ArgonNewsletterBot/0.1 (+https://argon.com.br)";
// How many redirects an address may take before it is given up on. Each hop is checked like the first.
export const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const WEB_PROTOCOLS = new Set(["http:", "https:"]);

export class FetchFailed extends Data.TaggedError("FetchFailed")<{ url: string; reason: string; status?: number }> {}
export class UrlNotAllowed extends Data.TaggedError("UrlNotAllowed")<{ url: string; reason: string }> {}
// The address answered, but not with what the caller reads: a PDF where a page was expected.
export class UnexpectedType extends Data.TaggedError("UnexpectedType")<{ url: string; reason: string }> {}
// The body is larger than the caller allows and cutting it would break it, as with a feed.
export class BodyTooLarge extends Data.TaggedError("BodyTooLarge")<{ url: string; reason: string }> {}

// ---------------------------------------------------------------------------------------------
// Which addresses are the outside world

type Subnet = readonly [network: string, prefix: number];

// Every special-purpose range of the IANA registries (RFC 6890 and its updates): this network,
// private, shared (carrier-grade NAT), loopback, link-local (the cloud metadata service lives there),
// documentation, benchmarking, multicast and reserved. An allowed source name that resolves here is
// not a source: it is something on the inside pretending to be one.
const SPECIAL_IPV4: readonly Subnet[] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];
const SPECIAL_IPV6: readonly Subnet[] = [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96], // NAT64: an IPv4 address in disguise
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23], // protocol assignments, Teredo among them
  ["2001:db8::", 32],
  ["2002::", 16], // 6to4: an IPv4 address in disguise
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
];

const SPECIAL = new BlockList();
for (const [network, prefix] of SPECIAL_IPV4) SPECIAL.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of SPECIAL_IPV6) SPECIAL.addSubnet(network, prefix, "ipv6");

const MAPPED_DOTTED = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i;
const MAPPED_HEX = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i;

// The IPv4 address inside an IPv4-mapped IPv6 one, in either spelling: `::ffff:169.254.169.254`
// and `::ffff:a9fe:a9fe` are the same metadata service.
function mappedIPv4(ip: string): string | null {
  const dotted = MAPPED_DOTTED.exec(ip);
  if (dotted) return dotted[1] ?? null;
  const hex = MAPPED_HEX.exec(ip);
  if (!hex) return null;
  const [high, low] = [parseInt(hex[1] ?? "0", 16), parseInt(hex[2] ?? "0", 16)];
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
}

export function isPublicAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 0) return false;
  if (version === 4) return !SPECIAL.check(ip, "ipv4");
  const mapped = mappedIPv4(ip);
  if (mapped) return isPublicAddress(mapped);
  // Mapped in a spelling not read above: refuse rather than guess.
  if (/^::ffff:/i.test(ip)) return false;
  return !SPECIAL.check(ip, "ipv6");
}

export type Resolved = { address: string; family: number };
export type Resolve = (hostname: string) => Promise<Resolved[]>;

// The one rule both checks apply: a name with no address, or with any address on the inside, is
// refused. Null when the name is fine.
export function refusal(hostname: string, addresses: readonly Resolved[]): string | null {
  if (addresses.length === 0) return `${hostname} has no address`;
  return addresses.some((entry) => !isPublicAddress(entry.address))
    ? `${hostname} resolves to a private address`
    : null;
}

// ---------------------------------------------------------------------------------------------
// The live network

// Node spells the family it wants as 4, 6, 0 (either) or, for old callers, "IPv4"/"IPv6".
function wantedFamily(family: LookupOptions["family"]): number {
  if (family === "IPv4") return 4;
  if (family === "IPv6") return 6;
  return family ?? 0;
}

const lookupError = (message: string, code: string) => Object.assign(new Error(message), { code });

// The check that counts happens when the socket opens. `guardUrl` resolves the name once to refuse
// early, but a fetch resolves it again to connect, and between the two a name can be pointed at the
// inside (DNS rebinding). Here the connection itself asks the resolver, refuses by the same rule,
// and connects to the address it checked — there is no second answer to trust.
export function guardedLookup(resolve: Resolve): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname).then(
      (addresses) => {
        const refused = refusal(hostname, addresses);
        if (refused) return callback(lookupError(refused, "EADDRNOTAVAIL"), "", 0);

        const family = wantedFamily(options.family);
        const usable = family === 0 ? addresses : addresses.filter((entry) => entry.family === family);
        const first = usable[0];
        if (!first) return callback(lookupError(`${hostname} has no IPv${family} address`, "ENOTFOUND"), "", 0);
        if (options.all) callback(null, usable);
        else callback(null, first.address, first.family);
      },
      (error: NodeJS.ErrnoException) => callback(error, "", 0),
    );
  };
}

const resolveAll: Resolve = (hostname) => dnsLookup(hostname, { all: true });

// One agent for the process, every live request connecting through the guarded lookup. Its own
// limits sit under any caller's deadline, so a server that accepts and then says nothing frees the
// socket instead of holding it for undici's five-minute defaults.
const guardedAgent = new Agent({
  connect: { lookup: guardedLookup(resolveAll), timeout: 5_000 },
  headersTimeout: 10_000,
  bodyTimeout: 10_000,
});

// What a fetch needs to answer: the status, the headers and a body to stream. Node's Response and
// undici's both fit, and so does a test's.
export type FetchResponse = {
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  body: ReadableStream<Uint8Array> | null;
};
export type FetchRequest = { headers: Record<string, string>; signal: AbortSignal; redirect: "manual" };

// What the fetch depends on, so a test — and the mock run — can answer the network and the resolver.
export type FetchDeps = {
  fetch: (url: string, init: FetchRequest) => Promise<FetchResponse>;
  resolve: Resolve;
};

export const liveDeps: FetchDeps = {
  // undici's own fetch, with its own agent: Node's global fetch carries another copy of undici, and
  // the two are not meant to be mixed.
  fetch: async (url, init) => {
    const response = await undiciFetch(url, { ...init, dispatcher: guardedAgent });
    return {
      status: response.status,
      ok: response.ok,
      headers: response.headers,
      body: response.body as ReadableStream<Uint8Array> | null,
    };
  },
  resolve: resolveAll,
};

// ---------------------------------------------------------------------------------------------
// One request

// Whether a parsed address may be read at all: the sources' domains, or a narrower list for a
// manual command. It runs after the scheme and the literal-address checks, so it only sees http(s)
// addresses with a name in them.
export type Allowed = (url: URL) => boolean;

export const guardUrl = (url: string, allowed: Allowed, deps: FetchDeps): Effect.Effect<URL, UrlNotAllowed> =>
  Effect.gen(function* () {
    const refuse = (reason: string) => new UrlNotAllowed({ url, reason });
    const parsed = yield* Effect.try({ try: () => new URL(url), catch: () => refuse("not a valid url") });
    if (!WEB_PROTOCOLS.has(parsed.protocol)) return yield* refuse(`scheme ${parsed.protocol} not allowed`);
    if (parsed.username || parsed.password) return yield* refuse("credentials in the url");
    if (isIP(parsed.hostname.replace(/^\[|\]$/g, "")) !== 0)
      return yield* refuse("ip address instead of a source name");
    if (!allowed(parsed)) return yield* refuse("domain not allowed");

    const addresses = yield* Effect.tryPromise({
      try: () => deps.resolve(parsed.hostname),
      catch: (error) => refuse(`dns: ${describeError(error)}`),
    });
    const refused = refusal(parsed.hostname, addresses);
    return refused ? yield* refuse(refused) : parsed;
  });

// A network error says little at the top — undici's is "fetch failed" — and what happened is in its
// cause: the refused address, the reset connection, the certificate. The log gets all of it.
export function describeError(error: unknown): string {
  const parts: string[] = [];
  for (let current: unknown = error; current instanceof Error && parts.length < 4; current = current.cause) {
    const { code } = current as NodeJS.ErrnoException;
    parts.push(code && !current.message.includes(code) ? `${current.message} (${code})` : current.message);
  }
  return parts.length > 0 ? parts.join(": ") : String(error);
}

const discard = (response: FetchResponse) => Effect.promise(() => response.body?.cancel() ?? Promise.resolve());

// Follows redirects by hand so each destination is checked like the first address, and never from
// https down to http: a source that is read encrypted is not read in the clear because a hop said
// so. The response that comes back is the final one, together with the address it was read from.
export const fetchGuarded = (
  url: string,
  p: { allowed: Allowed; deps: FetchDeps; accept: string; signal: AbortSignal },
): Effect.Effect<{ response: FetchResponse; url: string }, FetchFailed | UrlNotAllowed> =>
  Effect.gen(function* () {
    let current = url;
    for (let hop = 0; ; hop++) {
      const target = yield* guardUrl(current, p.allowed, p.deps);
      const response = yield* Effect.tryPromise({
        try: () =>
          p.deps.fetch(target.href, {
            headers: { "user-agent": USER_AGENT, accept: p.accept },
            signal: p.signal,
            redirect: "manual",
          }),
        catch: (error) => new FetchFailed({ url: current, reason: describeError(error) }),
      });
      if (!REDIRECT_STATUSES.has(response.status)) return { response, url: current };

      const location = response.headers.get("location");
      yield* discard(response);
      const fail = (reason: string) => new FetchFailed({ url: current, reason, status: response.status });
      if (!location) return yield* fail(`HTTP ${response.status} without location`);
      if (hop >= MAX_REDIRECTS) return yield* fail("too many redirects");
      const next = yield* Effect.try({
        try: () => new URL(location, current),
        catch: () => fail(`HTTP ${response.status} to an invalid location`),
      });
      if (target.protocol === "https:" && next.protocol === "http:")
        return yield* new UrlNotAllowed({ url: next.href, reason: "redirect from https to http" });
      current = next.href;
    }
  });

// What to do when the body passes the limit: a page is cut — the extraction reads the top and the
// rest is footer — and a feed fails, because a cut XML is a broken one and would be reported as such.
export type Overflow = "cut" | "fail";

// Reads the stream until it ends or `maxBytes` have arrived, whichever comes first, and says which.
async function drain(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<{ body: Buffer; over: boolean }> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return { body: Buffer.concat(chunks), over: false };
    const room = maxBytes - bytes;
    if (value.byteLength > room) {
      chunks.push(value.subarray(0, room));
      await reader.cancel();
      return { body: Buffer.concat(chunks), over: true };
    }
    chunks.push(value);
    bytes += value.byteLength;
  }
}

// At most `maxBytes` of the body, read as they arrive: a response that never ends is never held in
// memory whole.
export const readBytes = (
  response: FetchResponse,
  url: string,
  maxBytes: number,
  overflow: Overflow = "cut",
): Effect.Effect<Uint8Array, FetchFailed | BodyTooLarge> =>
  Effect.gen(function* () {
    if (!response.body) return new Uint8Array();
    const { body, over } = yield* Effect.tryPromise({
      try: () => drain(response.body as ReadableStream<Uint8Array>, maxBytes),
      catch: (error) => new FetchFailed({ url, reason: describeError(error) }),
    });
    if (over && overflow === "fail")
      return yield* new BodyTooLarge({ url, reason: `body over the limit of ${maxBytes} bytes` });
    return body;
  });

const CHARSET_LABEL = "[\\w.:-]+";
const HEADER_CHARSET = new RegExp(`charset\\s*=\\s*"?(${CHARSET_LABEL})`, "i");
const XML_CHARSET = new RegExp(`<\\?xml[^>]*encoding\\s*=\\s*["'](${CHARSET_LABEL})["']`, "i");
const META_CHARSET = new RegExp(`<meta[^>]*charset\\s*=\\s*["']?(${CHARSET_LABEL})`, "i");
// How much of the body the document's own declaration is looked for in; it sits at the top.
const DECLARATION_WINDOW = 1024;

// The charset a byte order mark announces, if the body starts with one.
function bomCharset(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  return null;
}

// The charset a body is written in, in the order a browser trusts it: a byte order mark, the
// header, then what the document says of itself (the XML prolog, or a `<meta charset>` near the
// top). Folha's feed is ISO-8859-1 and says so only in the prolog; read as UTF-8 every accent is lost.
export function charsetOf(contentType: string | null, bytes: Uint8Array): string {
  const bom = bomCharset(bytes);
  if (bom) return bom;
  const header = HEADER_CHARSET.exec(contentType ?? "")?.[1];
  if (header) return header.toLowerCase();
  const head = Buffer.from(bytes.subarray(0, DECLARATION_WINDOW)).toString("latin1");
  const declared = XML_CHARSET.exec(head)?.[1] ?? META_CHARSET.exec(head)?.[1];
  return (declared ?? "utf-8").toLowerCase();
}

// A label TextDecoder does not know is read as UTF-8 rather than failing the whole address. The
// byte order mark, if any, is dropped by the decoder.
export function decode(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

// ---------------------------------------------------------------------------------------------
// One body, read whole

export type Body = {
  url: string;
  status: number;
  contentType: string | null;
  bytes: number;
  charset: string;
  text: string;
};

export type BodyRequest = {
  allowed: Allowed;
  deps: FetchDeps;
  accept: string;
  // The content types the caller reads; anything else is refused before the body is downloaded.
  types?: RegExp;
  maxBytes: number;
  overflow: Overflow;
  // The whole request, from the first connection to the last byte of the body.
  timeout: Duration.DurationInput;
};

export type BodyError = FetchFailed | UrlNotAllowed | UnexpectedType | BodyTooLarge;

// Fetch, check, read and decode one address under one deadline. A status that is not 2xx is a
// failure carrying it; the deadline aborts the socket, so nothing keeps downloading after it.
export const fetchBody = (url: string, p: BodyRequest): Effect.Effect<Body, BodyError> =>
  Effect.suspend(() => {
    const controller = new AbortController();
    return read(url, p, controller.signal).pipe(Effect.onInterrupt(() => Effect.sync(() => controller.abort())));
  }).pipe(Effect.timeoutFail({ duration: p.timeout, onTimeout: () => new FetchFailed({ url, reason: "timeout" }) }));

const read = (url: string, p: BodyRequest, signal: AbortSignal): Effect.Effect<Body, BodyError> =>
  Effect.gen(function* () {
    const { response, url: finalUrl } = yield* fetchGuarded(url, { ...p, signal });
    if (!response.ok) {
      yield* discard(response);
      return yield* new FetchFailed({ url: finalUrl, reason: `HTTP ${response.status}`, status: response.status });
    }
    const contentType = response.headers.get("content-type");
    if (p.types && contentType && !p.types.test(contentType)) {
      yield* discard(response);
      return yield* new UnexpectedType({ url: finalUrl, reason: `unexpected content type: ${contentType}` });
    }
    const bytes = yield* readBytes(response, finalUrl, p.maxBytes, p.overflow);
    const charset = charsetOf(contentType, bytes);
    return {
      url: finalUrl,
      status: response.status,
      contentType,
      bytes: bytes.byteLength,
      charset,
      text: decode(bytes, charset),
    };
  });
