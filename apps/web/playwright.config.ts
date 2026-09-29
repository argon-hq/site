import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Plain http: the https dev script needs the local certificates.
    command: "pnpm dev:http",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Server actions cannot be intercepted from the browser, so the flows
      // that need the API point it at a port nothing listens on: every call
      // fails fast and the page shows its error state.
      API_URL: "http://127.0.0.1:9",
      INTERNAL_API_SECRET: "e2e",
    },
  },
});
