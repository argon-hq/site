// How many connections one pool may hold. Each API process opens two pools — Prisma here and
// Mastra's own (src/mastra). The number comes from the Postgres container that held the three
// environments until 04/11/2026, with `max_connections` at 50: 3 environments × (5 + 5) = 30, with
// room for psql and the backup. Each environment is a Neon branch of its own now, and the cap
// stayed: every execution environment of a Lambda function opens its own two pools. Kept apart
// from the Nest service so the Mastra side, which the Studio bundles on its own, can read it
// without pulling Nest in.
export const POOL_MAX = 5;
