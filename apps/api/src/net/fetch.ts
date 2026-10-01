import { Data, Effect } from "effect";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
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

export class FetchFailed extends Data.TaggedError("FetchFailed")<{ url: string; reason: string; status?: number }> {}
export class UrlNotAllowed extends Data.TaggedError("UrlNotAllowed")<{ url: string; reason: string }> {}

// What the fetch depends on, so a test — and the mock run — can answer the network and the resolver.
export type FetchDeps = {
  fetch: typeof fetch;
  lookup: (hostname: string) => Promise<{ address: string }[]>;
};

type Resolve = (hostname: string) => Promise<{ address: string; family: number }[]>;

// The check that counts happens when the socket opens. `guardUrl` resolves the name once to refuse
// early, but the fetch resolves it again to connect, and between the two a name can be pointed at
// the inside (DNS rebinding). Here the connection itself asks the resolver, refuses if any address
// is not public, and connects to the address it checked — there is no second answer to trust.
export function guardedLookup(resolve: Resolve): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname).then(
      (addresses) => {
        const blocked = addresses.find((entry) => !isPublicAddress(entry.address));
        if (addresses.length === 0 || blocked) {
          const reason = blocked ? `${hostname} resolves to a private address` : `${hostname} has no address`;
          callback(Object.assign(new Error(reason), { code: "EADDRNOTAVAIL" }), "", 0);
          return;
        }
        if (options.all) callback(null, addresses);
        else callback(null, (addresses[0] as { address: string }).address, (addresses[0] as { family: number }).family);
      },
      (error: NodeJS.ErrnoException) => callback(error, "", 0),
    );
  };
}

const resolveAll: Resolve = (hostname) => dnsLookup(hostname, { all: true });

// One agent for the process: every live request connects through the guarded lookup.
const guardedAgent = new Agent({ connect: { lookup: guardedLookup(resolveAll) } });

export const liveDeps: FetchDeps = {
  // undici's own fetch, with its own agent: Node's global fetch carries another copy of undici, and
  // the two are not meant to be mixed.
  fetch: ((input: Parameters<typeof undiciFetch>[0], init?: Parameters<typeof undiciFetch>[1]) =>
    undiciFetch(input, { ...init, dispatcher: guardedAgent })) as unknown as typeof fetch,
  lookup: resolveAll,
};

// Loopback, link-local (the cloud metadata service lives there), private ranges, and the IPv6
// equivalents. An allowed source name that resolves here is not a source: it is something on the
// inside pretending to be one.
export function isPublicAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
    return true;
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::" || lower === "::1") return false;
    if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) return false;
    // IPv4 mapped: judge the IPv4 inside.
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicAddress(mapped[1] as string);
    return true;
  }
  return false;
}

export type Allowed = (url: string) => boolean;

export const guardUrl = (url: string, allowed: Allowed, deps: FetchDeps): Effect.Effect<URL, UrlNotAllowed> =>
  Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: () => new URL(url),
      catch: () => new UrlNotAllowed({ url, reason: "not a valid url" }),
    });
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return yield* new UrlNotAllowed({ url, reason: `scheme ${parsed.protocol} not allowed` });
    }
    if (isIP(parsed.hostname.replace(/^\[|\]$/g, "")) !== 0) {
      return yield* new UrlNotAllowed({ url, reason: "ip address instead of a source name" });
    }
    if (!allowed(url)) return yield* new UrlNotAllowed({ url, reason: "domain not allowed" });

    const addresses = yield* Effect.tryPromise({
      try: () => deps.lookup(parsed.hostname),
      catch: (error) => new UrlNotAllowed({ url, reason: `dns: ${String(error)}` }),
    });
    if (addresses.length === 0) return yield* new UrlNotAllowed({ url, reason: "dns: no address" });
    if (addresses.some((entry) => !isPublicAddress(entry.address))) {
      return yield* new UrlNotAllowed({ url, reason: "resolves to a private address" });
    }
    return parsed;
  });

// Follows redirects by hand so each destination is checked like the first address. The response
// that comes back is the final one, together with the address it was read from.
export const fetchGuarded = (
  url: string,
  p: { allowed: Allowed; deps: FetchDeps; accept: string; signal: AbortSignal },
): Effect.Effect<{ response: Response; url: string }, FetchFailed | UrlNotAllowed> =>
  Effect.gen(function* () {
    let current = url;
    for (let hop = 0; ; hop++) {
      const target = yield* guardUrl(current, p.allowed, p.deps);
      const response = yield* Effect.tryPromise({
        try: () =>
          p.deps.fetch(target.toString(), {
            headers: { "user-agent": USER_AGENT, accept: p.accept },
            signal: p.signal,
            redirect: "manual",
          }),
        catch: (error) => new FetchFailed({ url: current, reason: String(error) }),
      });
      if (!REDIRECT_STATUSES.has(response.status)) return { response, url: current };

      const location = response.headers.get("location");
      yield* Effect.promise(() => response.body?.cancel() ?? Promise.resolve());
      if (!location)
        return yield* new FetchFailed({
          url: current,
          reason: `HTTP ${response.status} without location`,
          status: response.status,
        });
      if (hop + 1 > MAX_REDIRECTS) return yield* new FetchFailed({ url: current, reason: "too many redirects" });
      current = new URL(location, current).toString();
    }
  });

// At most `maxBytes` of the body, read as they arrive and cut when the limit is reached: a response
// that never ends must not be held in memory whole before it is sliced.
export const readBytes = (response: Response, url: string, maxBytes: number): Effect.Effect<Uint8Array, FetchFailed> =>
  Effect.tryPromise({
    try: async () => {
      if (!response.body) return new Uint8Array();
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const room = maxBytes - bytes;
        const slice = value.byteLength > room ? value.subarray(0, room) : value;
        chunks.push(slice);
        bytes += slice.byteLength;
        if (bytes >= maxBytes) {
          await reader.cancel();
          break;
        }
      }
      return Buffer.concat(chunks);
    },
    catch: (error) => new FetchFailed({ url, reason: String(error) }),
  });

// The charset a body is written in, in the order a browser trusts it: the header, then what the
// document says of itself (the XML prolog, or a `<meta charset>` near the top). Folha's feed is
// ISO-8859-1 and says so only in the prolog; read as UTF-8 every accent is lost.
export function charsetOf(contentType: string | null, bytes: Uint8Array): string {
  const header = /charset\s*=\s*"?([\w.:-]+)/i.exec(contentType ?? "")?.[1];
  if (header) return header.toLowerCase();
  const head = Buffer.from(bytes.subarray(0, 1024)).toString("latin1");
  const declared =
    /<\?xml[^>]*encoding\s*=\s*["']([\w.:-]+)["']/i.exec(head)?.[1] ??
    /<meta[^>]*charset\s*=\s*["']?([\w.:-]+)/i.exec(head)?.[1];
  return (declared ?? "utf-8").toLowerCase();
}

// A label TextDecoder does not know is read as UTF-8 rather than failing the whole address.
export function decode(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}
