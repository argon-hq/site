// How many connections one pool may hold. The Postgres container caps `max_connections` at 50 for
// three environments, and each API opens two pools — Prisma here and Mastra's own (src/mastra) — so
// the two pools of one API must fit in a third of that with room for psql and the backup:
// 3 environments × (5 + 5) = 30. Kept apart from the Nest service so the Mastra side, which the
// Studio bundles on its own, can read it without pulling Nest in.
export const POOL_MAX = 5;
