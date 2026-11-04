// Run once while the image is built (apps/api/Dockerfile), with NODE_COMPILE_CACHE set: it loads
// every module the app loads, without starting it, and Node keeps the compiled code in that
// directory. A cold start then reads that code instead of compiling it again. Measured on the
// instance on 04/11/2026: 4.35 s to /health/live without the cache, 3.6–3.9 s with it, also when
// the directory is read-only, as it is on Lambda.
//
// The values below only get the configuration past its checks: nothing here opens a connection,
// and none of them reaches the image's environment.
Object.assign(process.env, {
  NODE_ENV: "production",
  ARGON_ENV: "lab",
  DATABASE_URL: "postgresql://build:build@localhost:5432/build",
  ANTHROPIC_API_KEY: "build",
  INTERNAL_API_SECRET: "build-time-only-secret",
  UNSUBSCRIBE_TOKEN_SECRET: "build-time-only-secret-build-time-only",
  MAIL_TRANSPORT: "smtp",
  MAIL_FROM: "build@example.com",
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
require("./env");
// eslint-disable-next-line @typescript-eslint/no-require-imports
require("../app.module");
