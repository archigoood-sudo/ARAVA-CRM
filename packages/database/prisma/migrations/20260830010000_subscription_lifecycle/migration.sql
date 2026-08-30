ALTER TABLE "Subscription" ADD COLUMN "sequenceAfterSubscriptionId" TEXT;
ALTER TABLE "PaymentOperation" ADD COLUMN "saleSequenceAfterSubscriptionId" TEXT;
ALTER TABLE "SubscriptionLedger" ADD COLUMN "periodStartsAt" DATETIME;
ALTER TABLE "SubscriptionLedger" ADD COLUMN "periodEndsAt" DATETIME;

CREATE INDEX "Subscription_sequenceAfterSubscriptionId_idx"
ON "Subscription"("sequenceAfterSubscriptionId");
