-- Identity settings have no sensible default in code (see src/settings/settings.schema.ts).
-- Development values; prod adjusts them in the database. Idempotent.
INSERT INTO "setting" ("key", "value") VALUES
  ('sender', '{"name": "Argon", "address": "newsletter@dev.argon.eduardofockink.com", "postalAddress": "Passo Fundo, RS, Brasil"}'),
  ('privacy_policy_url', '"https://dev.argon.eduardofockink.com/privacy"'),
  ('asset_base_url', '"https://dev.argon.eduardofockink.com/email"'),
  ('social', '{"site": "https://dev.argon.eduardofockink.com"}')
ON CONFLICT ("key") DO NOTHING;
