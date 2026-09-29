import { HttpStatus } from "@nestjs/common";

// What every typed failure of the API carries: the reason, in one line and in English, and,
// where the failure is the caller's to act on and not the server's, the HTTP status that says so.
// A step that finds its edition missing answers 404; one that finds it busy or on its way out,
// 409; one that refuses what it was given, 422. Everything without a status is a 500: the database,
// the provider, the model — nothing a retry of the same request would change on its own.
export type Failure = { reason: string; status?: HttpStatus; step?: string };

export const NOT_FOUND = HttpStatus.NOT_FOUND;
export const CONFLICT = HttpStatus.CONFLICT;
export const UNPROCESSABLE = HttpStatus.UNPROCESSABLE_ENTITY;
