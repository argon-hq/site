import { z } from "zod";

/**
 * Shape of the confirmation and unsubscribe tokens the API issues. The actions
 * are public endpoints, so anything outside this never reaches the API.
 */
export const tokenSchema = z.string().min(20).max(100);

/** `?token=a&token=b` reaches a page as an array; the first value is the link's. */
export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
