import { describe, expect, it, vi } from "vitest";
import { switchLocation } from "./locale-switcher";

function fakeLocation(pathname: string, search = "", hash = "") {
  return { pathname, search, hash, assign: vi.fn(), reload: vi.fn() };
}

describe("switchLocation", () => {
  it("reloads an unprefixed URL, which the edge resolves by the cookie", () => {
    const location = fakeLocation("/newsletter/");

    switchLocation(location);

    expect(location.reload).toHaveBeenCalledTimes(1);
    expect(location.assign).not.toHaveBeenCalled();
  });

  it.each([
    ["/en-US/newsletter/", "?token=abc", "#top", "/newsletter/?token=abc#top"],
    ["/pt-BR/", "", "", "/"],
    ["/pt-BR", "", "", "/"],
  ])("drops the locale prefix of %s", (pathname, search, hash, expected) => {
    const location = fakeLocation(pathname, search, hash);

    switchLocation(location);

    expect(location.assign).toHaveBeenCalledWith(expected);
    expect(location.reload).not.toHaveBeenCalled();
  });
});
