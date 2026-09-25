import { Logger } from "@nestjs/common";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assetBaseUrl, assetsOrigin, assetUrls, EMAIL_ICONS, PUBLIC_BUCKET_URL } from "../assets";
import { EmailAssets } from "../assets.service";

const WEB_ORIGIN = "https://lab.argon.example";

// One response per URL, in the order the icons are listed.
function fetchReturning(responses: Array<{ status: number; type: string } | Error>) {
  const fetchMock = vi.fn(async () => {
    const next = responses.shift();
    if (next instanceof Error) throw next;
    if (!next) throw new Error("no response left");
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      headers: new Headers({ "content-type": next.type }),
    } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const png = { status: 200, type: "image/png" };

afterEach(() => vi.unstubAllGlobals());

describe("assetBaseUrl", () => {
  it("hangs the images off the origin of the site", () => {
    expect(assetBaseUrl(WEB_ORIGIN)).toBe("https://lab.argon.example/email");
  });

  it("does not double the slash when the origin carries one", () => {
    expect(assetBaseUrl("https://lab.argon.example/")).toBe("https://lab.argon.example/email");
  });

  it("lists every icon the template can ask for", () => {
    expect(assetUrls(WEB_ORIGIN)).toEqual(EMAIL_ICONS.map((icon) => `https://lab.argon.example/email/${icon}.png`));
  });
});

describe("assetsOrigin", () => {
  it("reads a deployed environment's images from its prefix in the public bucket", () => {
    expect(assetsOrigin({ ARGON_ENV: "prod", WEB_ORIGIN })).toBe(`${PUBLIC_BUCKET_URL}/prod`);
    expect(assetsOrigin({ ARGON_ENV: "lab", WEB_ORIGIN })).toBe(`${PUBLIC_BUCKET_URL}/lab`);
  });

  it("reads them from the site on a local machine", () => {
    expect(assetsOrigin({ ARGON_ENV: "local", WEB_ORIGIN })).toBe(WEB_ORIGIN);
    expect(assetsOrigin({ WEB_ORIGIN })).toBe(WEB_ORIGIN);
  });

  it("lets PUBLIC_ASSETS_ORIGIN win over both", () => {
    expect(assetsOrigin({ PUBLIC_ASSETS_ORIGIN: "https://cdn.example", ARGON_ENV: "dev", WEB_ORIGIN })).toBe(
      "https://cdn.example",
    );
  });
});

describe("EmailAssets", () => {
  it("passes when every image is served as an image", async () => {
    fetchReturning([png, png, png, png, png, png]);
    const statuses = await Effect.runPromise(new EmailAssets(WEB_ORIGIN).check());
    expect(statuses.every((status) => status.ok)).toBe(true);
  });

  // The failure that started this: the site answers, but with its 404 page.
  it("calls a 404 page broken and logs it with the URL", async () => {
    fetchReturning([png, png, png, { status: 404, type: "text/html; charset=utf-8" }, png, png]);
    const error = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

    const statuses = await Effect.runPromise(new EmailAssets(WEB_ORIGIN).report());

    expect(statuses.filter((status) => !status.ok)).toEqual([
      { url: "https://lab.argon.example/email/linkedin.png", ok: false, detail: "404 text/html; charset=utf-8" },
    ]);
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ msg: "email assets unreachable" }));
    error.mockRestore();
  });

  // A 200 that is not an image is a rewrite or a login wall, and arrives just as broken.
  it("calls a 200 that is not an image broken", async () => {
    fetchReturning([{ status: 200, type: "text/html" }, png, png, png, png, png]);
    const statuses = await Effect.runPromise(new EmailAssets(WEB_ORIGIN).check());
    expect(statuses[0]).toMatchObject({ ok: false, detail: "200 text/html" });
  });

  it("survives a site that does not answer at all", async () => {
    fetchReturning([new Error("timeout"), png, png, png, png, png]);
    const statuses = await Effect.runPromise(new EmailAssets(WEB_ORIGIN).check());
    expect(statuses[0]?.ok).toBe(false);
    expect(statuses[0]?.detail).toContain("timeout");
  });
});
