-- The selection takes the top of the model's ranking, as many as the edition holds (ARG-124):
-- there is no cutoff any more, so the setting goes, row and schema. The embedding column never
-- got a value — the same fact told twice is caught by the title signature in code and by the
-- model's `sameAs` in the triage — so it goes too. The `vector` extension stays: only its owner
-- may drop it, and the application's role is not, so it sits there unused and harmless.
DELETE FROM "setting" WHERE "key" = 'score_cutoff';
ALTER TABLE "article" DROP COLUMN IF EXISTS "embedding";
