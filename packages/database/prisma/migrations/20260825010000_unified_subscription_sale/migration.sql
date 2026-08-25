ALTER TABLE "Subscription" ADD COLUMN "saleIdempotencyKey" TEXT;

ALTER TABLE "PaymentOperation" ADD COLUMN "saleTariffId" TEXT;
ALTER TABLE "PaymentOperation" ADD COLUMN "saleStartsAt" DATETIME;
ALTER TABLE "PaymentOperation" ADD COLUMN "saleExpiresAt" DATETIME;
ALTER TABLE "PaymentOperation" ADD COLUMN "salePrice" INTEGER;
ALTER TABLE "PaymentOperation" ADD COLUMN "saleNotes" TEXT;
ALTER TABLE "PaymentOperation" ADD COLUMN "saleFinalizationError" TEXT;
ALTER TABLE "PaymentOperation" ADD COLUMN "saleFinalizationAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PaymentOperation" ADD COLUMN "saleFinalizedAt" DATETIME;

CREATE UNIQUE INDEX "Subscription_saleIdempotencyKey_key"
ON "Subscription"("saleIdempotencyKey");
