// Paths the Studio and the guard both have to agree on.

export const STUDIO_BASE_PATH = "/studio";
export const MASTRA_API_PREFIX = "/mastra";

// The one Mastra route open where the Studio is served. The Studio asks it before it renders
// anything, and a browser cannot put the internal secret on that first call: answering 401 leaves a
// dead error screen with no way in — not even the Studio's own settings, which is where the secret
// is typed. It tells whether Mastra's own auth is enabled and nothing else
// (`{"enabled":false,"login":null}`), so opening it gives away nothing the page does not already say.
export const STUDIO_BOOTSTRAP_PATH = `${MASTRA_API_PREFIX}/auth/capabilities`;
