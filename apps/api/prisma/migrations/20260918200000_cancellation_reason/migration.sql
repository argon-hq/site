-- Why a subscription ended. Written together with `status = cancelled` and `cancelled_at`,
-- by the unsubscribe page, the List-Unsubscribe header, the bounce webhook or the operator.

-- CreateEnum
CREATE TYPE "cancellation_reason" AS ENUM ('user', 'complaint', 'hard_bounce', 'soft_bounce', 'manual');

-- AlterTable
ALTER TABLE "subscriber" ADD COLUMN "cancellation_reason" "cancellation_reason";
