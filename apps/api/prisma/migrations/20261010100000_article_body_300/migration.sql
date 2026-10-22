-- The article body keeps its target of 260 characters and gets forty of slack instead of twelve
-- (src/mastra/schemas/edition.ts): a paragraph a few words over the target is kept, not sent back
-- for a second attempt. The database holds the hard limit.
ALTER TABLE "article" DROP CONSTRAINT "article_body_length";
ALTER TABLE "article" ADD CONSTRAINT "article_body_length" CHECK ("body" IS NULL OR char_length("body") <= 300);
