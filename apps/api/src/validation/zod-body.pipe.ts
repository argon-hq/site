import { BadRequestException, PipeTransform } from "@nestjs/common";
import type { ZodType } from "zod";

// Validates a request body against a Zod schema and returns the typed value.
export function ZodBody<T>(schema: ZodType<T>): PipeTransform<unknown, T> {
  return {
    transform(value: unknown): T {
      const result = schema.safeParse(value);
      if (!result.success) throw new BadRequestException(result.error.issues);
      return result.data;
    },
  };
}
