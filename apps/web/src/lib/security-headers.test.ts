import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "./security-headers";

describe("contentSecurityPolicy", () => {
  it("lets the browser reach the API and nothing else outside the site", () => {
    expect(contentSecurityPolicy("https://api.lab.argonbusiness.com")).toBe(
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data:; font-src 'self' data:; connect-src 'self' https://api.lab.argonbusiness.com; " +
        "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
  });

  it("allows eval only in development", () => {
    expect(contentSecurityPolicy("http://localhost:3001", { development: true })).toContain(
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    );
  });
});
