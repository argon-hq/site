-- Indexes for the two queries every collection run makes over tables that only grow: the
-- writing step asks for recent, unassigned, above-cutoff articles, and the collector asks for
-- what it already looked at. Partial where the query is, so the index stays small and hot.
CREATE INDEX "seen_url_seen_at_idx" ON "seen_url"("seen_at");
CREATE INDEX "article_created_at_idx" ON "article"("created_at" DESC);
CREATE INDEX "article_unassigned_recent_idx" ON "article"("created_at", "score" DESC)
  WHERE "edition_id" IS NULL AND "extracted_text" IS NOT NULL;

-- The token hashes are unique by construction (256 random bits, or a signature over the id). The
-- database now says so too: a lookup by hash can never land on the wrong subscriber, whatever a
-- future bug does to the way the tokens are made. Partial, because most of the time the column is
-- empty and Prisma has no syntax for a partial unique index, so these two live only here.
CREATE UNIQUE INDEX "subscriber_token_hash_key" ON "subscriber"("token_hash") WHERE "token_hash" IS NOT NULL;
CREATE UNIQUE INDEX "subscriber_unsubscribe_token_hash_key" ON "subscriber"("unsubscribe_token_hash")
  WHERE "unsubscribe_token_hash" IS NOT NULL;
