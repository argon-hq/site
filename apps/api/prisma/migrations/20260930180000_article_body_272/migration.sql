-- The article body grows from 190 to a target of 260 characters, with twelve of slack for a
-- paragraph a word over it (src/mastra/schemas/edition.ts). The database holds the hard limit.
ALTER TABLE "article" DROP CONSTRAINT "article_body_length";
ALTER TABLE "article" ADD CONSTRAINT "article_body_length" CHECK ("body" IS NULL OR char_length("body") <= 272);
