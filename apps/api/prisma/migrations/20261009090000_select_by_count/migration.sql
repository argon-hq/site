-- The selection takes the top of the model's ranking, as many as the edition holds (ARG-124):
-- there is no cutoff any more, so the setting goes, row and schema. The embedding column never
-- got a value — the same fact told twice is caught by the title signature in code and by the
-- model's `sameAs` in the triage — so it goes too, with the extension nothing else uses.
DELETE FROM "setting" WHERE "key" = 'score_cutoff';
ALTER TABLE "article" DROP COLUMN "embedding";
DROP EXTENSION IF EXISTS "vector";
