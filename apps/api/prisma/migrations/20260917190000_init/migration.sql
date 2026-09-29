-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "subscriber_status" AS ENUM ('pending', 'confirmed', 'cancelled', 'bounced', 'blocked');

-- CreateEnum
CREATE TYPE "article_category" AS ENUM ('business', 'entrepreneurship', 'technology', 'economy', 'politics');

-- CreateEnum
CREATE TYPE "edition_status" AS ENUM ('generating', 'ready', 'sending', 'sent', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "delivery_status" AS ENUM ('pending', 'sent', 'delivered', 'soft_bounce', 'hard_bounce', 'complaint', 'failed');

-- CreateTable
CREATE TABLE "subscriber" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "status" "subscriber_status" NOT NULL DEFAULT 'pending',
    "token_hash" TEXT,
    "token_expires_at" TIMESTAMPTZ,
    "unsubscribe_token_hash" TEXT,
    "confirmation_sends" SMALLINT NOT NULL DEFAULT 0,
    "last_confirmation_sent_at" TIMESTAMPTZ,
    "consent_at" TIMESTAMPTZ,
    "consent_ip" INET,
    "consent_user_agent" TEXT,
    "policy_version" TEXT,
    "signed_up_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "soft_bounces" SMALLINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscriber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "edition_id" UUID,
    "canonical_url" TEXT NOT NULL,
    "source_name" TEXT NOT NULL,
    "original_title" TEXT NOT NULL,
    "extracted_text" TEXT,
    "published_at" TIMESTAMPTZ,
    "category" "article_category",
    "embedding" vector(1536),
    "score" DECIMAL(5,2),
    "score_details" JSONB,
    "headline" TEXT,
    "body" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "article_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "edition" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "date" DATE NOT NULL,
    "status" "edition_status" NOT NULL DEFAULT 'generating',
    "title" TEXT,
    "subject" TEXT,
    "html" TEXT,
    "text" TEXT,
    "sent_at" TIMESTAMPTZ,
    "review_log" JSONB NOT NULL DEFAULT '[]',
    "token_cost" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "edition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "edition_id" UUID NOT NULL,
    "subscriber_id" UUID NOT NULL,
    "batch" INTEGER NOT NULL,
    "status" "delivery_status" NOT NULL DEFAULT 'pending',
    "provider_email_id" TEXT,
    "sent_at" TIMESTAMPTZ,
    "error" TEXT,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "seen_url" (
    "url" TEXT NOT NULL,
    "seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seen_url_pkey" PRIMARY KEY ("url")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscriber_email_key" ON "subscriber"("email");

-- CreateIndex
CREATE INDEX "subscriber_status_idx" ON "subscriber"("status");

-- CreateIndex
CREATE INDEX "subscriber_token_hash_idx" ON "subscriber"("token_hash");

-- CreateIndex
CREATE INDEX "subscriber_unsubscribe_token_hash_idx" ON "subscriber"("unsubscribe_token_hash");

-- CreateIndex
CREATE INDEX "subscriber_token_expires_at_idx" ON "subscriber"("token_expires_at");

-- CreateIndex
CREATE INDEX "subscriber_cancelled_at_idx" ON "subscriber"("cancelled_at");

-- CreateIndex
CREATE UNIQUE INDEX "article_canonical_url_key" ON "article"("canonical_url");

-- CreateIndex
CREATE INDEX "article_published_at_idx" ON "article"("published_at" DESC);

-- CreateIndex
CREATE INDEX "article_edition_id_score_idx" ON "article"("edition_id", "score" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "edition_date_key" ON "edition"("date");

-- CreateIndex
CREATE INDEX "delivery_edition_id_status_idx" ON "delivery"("edition_id", "status");

-- CreateIndex
CREATE INDEX "delivery_provider_email_id_idx" ON "delivery"("provider_email_id");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_edition_id_subscriber_id_key" ON "delivery"("edition_id", "subscriber_id");

-- AddForeignKey
ALTER TABLE "article" ADD CONSTRAINT "article_edition_id_fkey" FOREIGN KEY ("edition_id") REFERENCES "edition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_edition_id_fkey" FOREIGN KEY ("edition_id") REFERENCES "edition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_subscriber_id_fkey" FOREIGN KEY ("subscriber_id") REFERENCES "subscriber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Rules Prisma cannot express. Kept here so every environment gets them with `migrate deploy`.

-- Check constraints
ALTER TABLE "subscriber" ADD CONSTRAINT "subscriber_email_normalized" CHECK ("email" = lower(btrim("email")));
ALTER TABLE "subscriber" ADD CONSTRAINT "subscriber_pending_has_token" CHECK ("status" <> 'pending' OR ("token_hash" IS NOT NULL AND "token_expires_at" IS NOT NULL));
ALTER TABLE "subscriber" ADD CONSTRAINT "subscriber_confirmed_has_consent" CHECK ("status" <> 'confirmed' OR ("consent_at" IS NOT NULL AND "unsubscribe_token_hash" IS NOT NULL));
ALTER TABLE "subscriber" ADD CONSTRAINT "subscriber_cancelled_has_date" CHECK ("status" NOT IN ('cancelled', 'blocked') OR "cancelled_at" IS NOT NULL);
ALTER TABLE "article" ADD CONSTRAINT "article_body_length" CHECK ("body" IS NULL OR char_length("body") <= 190);
ALTER TABLE "article" ADD CONSTRAINT "article_selected_has_score" CHECK ("edition_id" IS NULL OR "score" IS NOT NULL);
ALTER TABLE "edition" ADD CONSTRAINT "edition_subject_length" CHECK ("subject" IS NULL OR char_length("subject") <= 78);
ALTER TABLE "edition" ADD CONSTRAINT "edition_sent_complete" CHECK ("status" <> 'sent' OR ("sent_at" IS NOT NULL AND "title" IS NOT NULL AND "subject" IS NOT NULL AND "html" IS NOT NULL AND "text" IS NOT NULL));

-- updated_at maintained by the database, so raw SQL and Studio edits behave like Prisma writes
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER subscriber_updated_at BEFORE UPDATE ON "subscriber" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER article_updated_at BEFORE UPDATE ON "article" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER edition_updated_at BEFORE UPDATE ON "edition" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER delivery_updated_at BEFORE UPDATE ON "delivery" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER setting_updated_at BEFORE UPDATE ON "setting" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A sent edition does not change: headline, body, score and link of its articles are frozen
CREATE OR REPLACE FUNCTION article_frozen_after_send() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.edition_id IS NOT NULL
     AND (NEW.headline IS DISTINCT FROM OLD.headline
          OR NEW.body IS DISTINCT FROM OLD.body
          OR NEW.score IS DISTINCT FROM OLD.score
          OR NEW.canonical_url IS DISTINCT FROM OLD.canonical_url
          OR NEW.edition_id IS DISTINCT FROM OLD.edition_id)
     AND EXISTS (SELECT 1 FROM "edition" e WHERE e.id = OLD.edition_id AND e.status = 'sent') THEN
    RAISE EXCEPTION 'article % belongs to a sent edition and cannot change', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER article_frozen_after_send BEFORE UPDATE ON "article" FOR EACH ROW EXECUTE FUNCTION article_frozen_after_send();

-- Initial settings; `sending_paused` is the kill switch. The identity keys have no sensible
-- default in code (see src/settings/settings.schema.ts) and carry development values here;
-- prod adjusts them in the database. Idempotent so re-running never overwrites operator changes.
INSERT INTO "setting" ("key", "value") VALUES
  ('sending_paused', 'false'),
  ('min_articles', '3'),
  ('max_articles', '6'),
  ('score_cutoff', '3.0'),
  ('owner_emails', '[]'),
  ('policy_version', '""'),
  ('sender', '{"name": "Argon", "address": "newsletter@dev.argon.eduardofockink.com", "postalAddress": "Passo Fundo, RS, Brasil"}'),
  ('privacy_policy_url', '"https://dev.argon.eduardofockink.com/privacy"'),
  ('asset_base_url', '"https://dev.argon.eduardofockink.com/email"'),
  ('social', '{"site": "https://dev.argon.eduardofockink.com"}')
ON CONFLICT ("key") DO NOTHING;
