import { describe, expect, it } from "vitest";
import { renderStudioHtml } from "./studio.html";

const template = `<base href="%%MASTRA_STUDIO_BASE_PATH%%/" />
window.MASTRA_SERVER_PROTOCOL = '%%MASTRA_SERVER_PROTOCOL%%';
window.MASTRA_SERVER_HOST = '%%MASTRA_SERVER_HOST%%';
window.MASTRA_SERVER_PORT = '%%MASTRA_SERVER_PORT%%';
window.MASTRA_API_PREFIX = '%%MASTRA_API_PREFIX%%';
window.MASTRA_TEMPLATES = '%%MASTRA_TEMPLATES%%';`;

describe("renderStudioHtml", () => {
  it("points the Studio at the origin it was served from", () => {
    const html = renderStudioHtml(template, new URL("https://dev.argon.eduardofockink.com/studio"));

    expect(html).toContain(`window.MASTRA_SERVER_PROTOCOL = 'https'`);
    expect(html).toContain(`window.MASTRA_SERVER_HOST = 'dev.argon.eduardofockink.com'`);
    expect(html).toContain(`window.MASTRA_SERVER_PORT = '443'`);
    expect(html).toContain(`window.MASTRA_API_PREFIX = '/mastra'`);
    expect(html).toContain(`<base href="/studio/" />`);
  });

  it("keeps the port when the origin carries one", () => {
    const html = renderStudioHtml(template, new URL("http://localhost:3001/studio"));

    expect(html).toContain(`window.MASTRA_SERVER_PORT = '3001'`);
    expect(html).toContain(`window.MASTRA_SERVER_PROTOCOL = 'http'`);
  });

  // Left in place, a placeholder reaches the browser as the literal string and reads as truthy.
  it("empties the placeholders it does not fill", () => {
    const html = renderStudioHtml(template, new URL("http://localhost:3001/studio"));

    expect(html).toContain(`window.MASTRA_TEMPLATES = ''`);
    expect(html).not.toContain("%%");
  });
});
