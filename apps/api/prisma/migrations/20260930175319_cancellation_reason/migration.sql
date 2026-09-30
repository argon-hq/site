-- Why a subscription was cancelled (ARG-49, ARG-149). `user` is the subscriber's own click, on the page or
-- through the mail client's one-click; `manual` is a request to the data protection officer; `complaint` and
-- `bounce` are for the provider's webhook (ARG-100).
CREATE TYPE "cancellation_reason" AS ENUM ('user', 'complaint', 'bounce', 'manual');

ALTER TABLE "subscriber" ADD COLUMN "cancellation_reason" "cancellation_reason";

-- Until now the only ways out were the page and the one-click, both the subscriber's own.
UPDATE "subscriber" SET "cancellation_reason" = 'user' WHERE "status" = 'cancelled' AND "cancellation_reason" IS NULL;

-- No check yet that every cancelled row carries a reason: this runs while the previous API is still serving,
-- and that code cancels without one. The constraint comes in a later migration, once this code is what runs.
