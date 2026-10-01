-- Whatever names a host left the identity settings: the sender's address is MAIL_FROM, per
-- environment, and the site and the privacy policy derive from WEB_ORIGIN. The seeded rows carried
-- dev's domain into every environment, so a fresh prod database mailed from dev's domain and linked
-- its readers to dev's site. Same move asset_base_url made on 23/09.
UPDATE "setting" SET "value" = "value" - 'address' WHERE "key" = 'sender';

DELETE FROM "setting" WHERE "key" = 'privacy_policy_url';

-- The networks lose the site and every placeholder copied from it on 25/09: a network not set falls
-- back to the environment's own site in code. A profile an operator has set stays.
UPDATE "setting" AS s
SET "value" = (
  SELECT COALESCE(jsonb_object_agg(e.k, e.v), '{}'::jsonb)
  FROM jsonb_each(s."value") AS e(k, v)
  WHERE e.k <> 'site' AND e.v IS DISTINCT FROM s."value"->'site'
)
WHERE s."key" = 'social';
