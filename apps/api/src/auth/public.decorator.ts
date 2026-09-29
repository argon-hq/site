import { SetMetadata } from "@nestjs/common";

// A symbol, not a string: @mastra/nestjs marks its own /health, /ready and /info with the metadata
// key "isPublic", and a string key of the same name would hand those routes our exemption too.
export const IS_PUBLIC = Symbol("argon.isPublic");
// Marks a route that skips the internal secret check.
export const Public = () => SetMetadata(IS_PUBLIC, true);
