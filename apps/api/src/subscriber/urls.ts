// Every address the subscriber reaches from an e-mail, each carrying one of their tokens. The
// e-mail builders receive them ready (they build no URL); the format is decided here.

export type Origins = { web: string; api: string };

// Injection token: the module binds the two origins from the environment once.
export const ORIGINS = "ORIGINS";

// Where the confirmation e-mail points: a one-time token that expires, and a page that confirms.
export function confirmUrl({ web }: Origins, token: string): string {
  return `${web}/newsletter/confirm?token=${encodeURIComponent(token)}`;
}

// The page: what the link in the footer of every edition points at. It confirms before cancelling,
// because a GET that cancelled would unsubscribe people through the link scanners in mail clients.
export function unsubscribePageUrl({ web }: Origins, token: string): string {
  return `${web}/newsletter/unsubscribe?token=${encodeURIComponent(token)}`;
}

// The edition is built once for everyone, so the stored HTML cannot carry a real token. It carries
// this one instead, and the sending step swaps it for each subscriber's. A sentinel, not a template
// syntax: it is an absolute https URL, so the built edition passes the same validation as a real one.
export const UNSUBSCRIBE_PLACEHOLDER = "__UNSUBSCRIBE_TOKEN__";

export function unsubscribePlaceholderUrl(origins: Origins): string {
  return unsubscribePageUrl(origins, UNSUBSCRIBE_PLACEHOLDER);
}

// The endpoint the mail client posts to by itself (RFC 8058). It is on the API, which is public and
// needs no secret here: the token is the credential, and the request comes from Gmail, not the site.
export function unsubscribeOneClickUrl({ api }: Origins, token: string): string {
  return `${api}/subscriber/unsubscribe/one-click?token=${encodeURIComponent(token)}`;
}

// A single HTTPS URI in `List-Unsubscribe`, on purpose: with more than one, which address the
// client posts to is undefined, and the one-click has to land on the endpoint that expects a POST.
export function unsubscribeHeaders(origins: Origins, token: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${unsubscribeOneClickUrl(origins, token)}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
