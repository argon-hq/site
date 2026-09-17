import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC = "isPublic";
// Marks a route that skips the internal secret check.
export const Public = () => SetMetadata(IS_PUBLIC, true);
