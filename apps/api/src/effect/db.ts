import { Effect } from "effect";

// One database call as an effect, failing with the caller's own error: every step has a tagged
// failure of its own so the boundary can tell them apart, and this is the plumbing they share.
export const dbEffect =
  <E>(fail: (reason: string) => E) =>
  <A>(run: () => Promise<A>): Effect.Effect<A, E> =>
    Effect.tryPromise({ try: run, catch: (error) => fail(String(error)) });
