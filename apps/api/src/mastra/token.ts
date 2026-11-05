import type { mastra } from ".";

// How a service asks Nest for the Mastra instance (MastraInstanceModule provides it). Apart from the
// module, and with a type-only import, so a service and its test can name the instance without
// loading it — loading it reads the whole configuration.
export const MASTRA = Symbol("MASTRA");
export type ArgonMastra = typeof mastra;
