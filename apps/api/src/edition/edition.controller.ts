import { Body, Controller, Post } from "@nestjs/common";
import { z } from "zod";
import { ZodBody } from "../validation/zod-body.pipe";
import { EditionService } from "./edition.service";

const writeBody = z.object({ url: z.string().url() });

@Controller("edition")
export class EditionController {
  constructor(private readonly editions: EditionService) {}

  // POST /edition/write { url } → article + written edition. Internal secret required.
  @Post("write")
  write(@Body(ZodBody(writeBody)) body: z.infer<typeof writeBody>) {
    return this.editions.writeFromUrl(body.url);
  }
}
