import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { StudioController } from "./studio.controller";
import type { StudioService } from "./studio.service";

// A refresh-events client: the response it writes to, and the close the browser sends when it goes.
function client() {
  let onClose = () => {};
  const response = { writeHead: vi.fn(), write: vi.fn(), end: vi.fn() };
  const request = {
    on: (event: string, handler: () => void) => {
      if (event === "close") onClose = handler;
    },
  };
  return {
    request: request as unknown as Request,
    response: response as unknown as Response,
    ended: () => response.end.mock.calls.length > 0,
    disconnect: () => onClose(),
  };
}

describe("StudioController refresh-events", () => {
  const controller = () => new StudioController({} as StudioService);

  it("ends the streams it is holding when the application shuts down", () => {
    const studio = controller();
    const [a, b] = [client(), client()];

    studio.events(a.request, a.response);
    studio.events(b.request, b.response);
    expect(a.ended()).toBe(false);

    studio.beforeApplicationShutdown();

    expect(a.ended()).toBe(true);
    expect(b.ended()).toBe(true);
  });

  // Without this the set grows for the life of the process, one entry per page load.
  it("forgets a stream whose client already went away", () => {
    const studio = controller();
    const gone = client();

    studio.events(gone.request, gone.response);
    gone.disconnect();
    studio.beforeApplicationShutdown();

    expect(gone.ended()).toBe(false);
  });
});
