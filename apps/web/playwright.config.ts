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
      // The browser calls the API directly. A port nothing listens on makes
      // every call fail fast, so the page shows its error state; a test that
      // needs an answer can stub it with page.route.
      NEXT_PUBLIC_API_ORIGIN: "http://127.0.0.1:9",
    },
  },
});
