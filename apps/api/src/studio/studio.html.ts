// The Studio ships as a static bundle whose index.html carries %%NAME%% placeholders; the
// `mastra dev` and `mastra studio` commands fill them at startup. We serve the same bundle from the
// API, so we fill them here.
//
// Everything points at the origin the request arrived on. The Studio and the Mastra routes answer
// on the same host — Caddy sends both /studio and /mastra to this container — so the browser calls
// the API same-origin: no CORS, and the `x-internal-secret` the operator saves in the Studio
// travels on every call it makes.

export const STUDIO_BASE_PATH = "/studio";
export const MASTRA_API_PREFIX = "/mastra";

export function renderStudioHtml(template: string, origin: URL): string {
  const values: Record<string, string> = {
    MASTRA_STUDIO_BASE_PATH: STUDIO_BASE_PATH,
    MASTRA_SERVER_PROTOCOL: origin.protocol.replace(":", ""),
    MASTRA_SERVER_HOST: origin.hostname,
    // The Studio always builds host:port, so the default port has to be spelled out.
    MASTRA_SERVER_PORT: origin.port || (origin.protocol === "https:" ? "443" : "80"),
    MASTRA_API_PREFIX,
    // This Studio talks to this API and to nothing else: no telemetry, no cloud, and no asking the
    // browser to go looking for an instance somewhere.
    MASTRA_TELEMETRY_DISABLED: "true",
    MASTRA_HIDE_CLOUD_CTA: "true",
    MASTRA_AUTO_DETECT_URL: "false",
  };
  // A placeholder we do not fill is emptied, never left behind: the Studio reads these as values,
  // and the literal "%%MASTRA_TEMPLATES%%" is a truthy string.
  return template.replace(/%%([A-Z_]+)%%/g, (_, name: string) => values[name] ?? "");
}
