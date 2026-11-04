import { z } from "zod";

/**
 * Shape of the confirmation and unsubscribe tokens the API issues. A token
 * outside it is an invalid link right away, without a round trip to the API.
 */
export const tokenSchema = z.string().min(20).max(100);
