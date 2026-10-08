-- The article body gets a floor of 100 characters (src/mastra/schemas/edition.ts): under it the
-- item says too little to hold a place in the edition. NOT VALID checks the rows written from now on
-- and leaves alone the ones already sent, which were written under the old rules and never change.
ALTER TABLE "article" ADD CONSTRAINT "article_body_min" CHECK ("body" IS NULL OR char_length("body") >= 100) NOT VALID;
