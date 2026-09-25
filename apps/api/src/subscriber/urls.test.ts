import { describe, expect, it } from "vitest";
import { confirmUrl, unsubscribeHeaders, unsubscribeOneClickUrl, unsubscribePageUrl } from "./urls";

const origins = { web: "https://argon.example", api: "https://api.argon.example", assets: "https://argon.example" };
// base64url has `-` and `_`, which survive a query string; a token is never re-encoded by hand.
const token = "aB3-_xY9";

describe("subscriber URLs", () => {
  it("points the confirmation e-mail at the page that confirms", () => {
    expect(confirmUrl(origins, token)).toBe("https://argon.example/newsletter/confirm?token=aB3-_xY9");
  });

  it("points the footer link at the page that confirms", () => {
    expect(unsubscribePageUrl(origins, token)).toBe("https://argon.example/newsletter/unsubscribe?token=aB3-_xY9");
  });

  it("points one-click at the API endpoint that takes the POST", () => {
    expect(unsubscribeOneClickUrl(origins, token)).toBe(
      "https://api.argon.example/subscriber/unsubscribe/one-click?token=aB3-_xY9",
    );
  });

  it("announces a single URI, the one that accepts the POST", () => {
    const headers = unsubscribeHeaders(origins, token);
    expect(headers["List-Unsubscribe"]).toBe(`<${unsubscribeOneClickUrl(origins, token)}>`);
    expect(headers["List-Unsubscribe"]).not.toContain(",");
    expect(headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("escapes a token that would break the query string", () => {
    expect(unsubscribePageUrl(origins, "a b&c=d")).toBe(
      "https://argon.example/newsletter/unsubscribe?token=a%20b%26c%3Dd",
    );
  });
});
