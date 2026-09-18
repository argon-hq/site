-- CreateTable
CREATE TABLE "seen_url" (
    "url" TEXT NOT NULL,
    "seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seen_url_pkey" PRIMARY KEY ("url")
);
