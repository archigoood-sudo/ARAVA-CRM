ALTER TABLE "PaymentOperation" ADD COLUMN "warningResolvedAt" DATETIME;
ALTER TABLE "PaymentOperation" ADD COLUMN "warningResolvedByUserId" TEXT;
ALTER TABLE "PaymentOperation" ADD COLUMN "warningResolutionType" TEXT;
ALTER TABLE "PaymentOperation" ADD COLUMN "warningResolutionNote" TEXT;
ALTER TABLE "PaymentOperation" ADD COLUMN "providerOutcome" TEXT;
ALTER TABLE "PaymentOperation" ADD COLUMN "providerOutcomeCheckedAt" DATETIME;
ALTER TABLE "PaymentOperation" ADD COLUMN "providerPaymentConfirmedAt" DATETIME;
