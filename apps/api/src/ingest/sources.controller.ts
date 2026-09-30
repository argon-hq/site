import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { runEffect } from "../effect/nest";
import { ZodBody } from "../validation/zod-body.pipe";
import {
  domainSchema,
  feedInputSchema,
  sourceCreateSchema,
  sourcePatchSchema,
  type FeedInput,
  type SourceCreate,
  type SourcePatch,
} from "./sources.schema";
import { SourcesService } from "./sources.service";

// The sources of this environment, changed without a deploy. Every route requires the internal
// secret, like everything but the public few; every write is validated here and logged with the
// before and the after by the service. A change counts from the next ingestion.
@Controller("sources")
export class SourcesController {
  constructor(private readonly sources: SourcesService) {}

  // GET /sources → every source with its addresses and its health.
  @Get()
  list() {
    return runEffect("sources", this.sources.list());
  }

  // POST /sources { domain, name, covers, trust?, active?, sectionRules?, feeds? } → a new source.
  @Post()
  create(@Body(ZodBody(sourceCreateSchema)) body: SourceCreate) {
    return runEffect("sources", this.sources.create(body));
  }

  // PATCH /sources/:domain { name?, covers?, trust?, active?, sectionRules? } → changes a source.
  // `active: false` takes it out of the next ingestion and out of the allowlist with it.
  @Patch(":domain")
  update(@Param("domain", ZodBody(domainSchema)) domain: string, @Body(ZodBody(sourcePatchSchema)) body: SourcePatch) {
    return runEffect("sources", this.sources.update(domain, body));
  }

  // POST /sources/:domain/feeds { kind, url } → one more address; it must be on the source's domain.
  @Post(":domain/feeds")
  addFeed(@Param("domain", ZodBody(domainSchema)) domain: string, @Body(ZodBody(feedInputSchema)) body: FeedInput) {
    return runEffect("sources", this.sources.addFeed(domain, body));
  }

  // DELETE /sources/:domain/feeds/:id → one address less.
  @Delete(":domain/feeds/:id")
  @HttpCode(200)
  removeFeed(@Param("domain", ZodBody(domainSchema)) domain: string, @Param("id", new ParseUUIDPipe()) id: string) {
    return runEffect("sources", this.sources.removeFeed(domain, id));
  }
}
