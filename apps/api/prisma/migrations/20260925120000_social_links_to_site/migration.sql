-- The footer of every e-mail shows a network only when `social` has its URL, and until now only
-- the site was set. Until the Argon profiles exist, LinkedIn, Instagram and YouTube point at the
-- company site each environment already has. Only fills a missing key: a network an operator has
-- set is never touched, and the real profiles replace these through PATCH /settings.
UPDATE "setting"
SET "value" = jsonb_build_object('linkedin', "value"->'site', 'instagram', "value"->'site', 'youtube', "value"->'site') || "value"
WHERE "key" = 'social' AND "value" ? 'site';
