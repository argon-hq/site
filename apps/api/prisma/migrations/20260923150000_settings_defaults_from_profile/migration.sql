-- The cutoff and the article bounds now take their default from the environment's profile
-- (src/pipeline/profile.ts), so lab and a development machine accept a weaker edition than
-- production without anyone setting a row first.
--
-- The init migration seeded the three with production's numbers, which is exactly what the profile
-- already says, so the rows only got in the way: a seeded row would win over the environment's
-- default everywhere. They go. A row here means "this environment decided otherwise", and the
-- settings route is how one is written. Every other setting keeps its row — `owner_emails` and the
-- sender identity carry real values that no default could replace.
DELETE FROM "setting" WHERE "key" IN ('score_cutoff', 'min_articles', 'max_articles');
