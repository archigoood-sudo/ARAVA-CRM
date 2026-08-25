ALTER TABLE "Attendance" ADD COLUMN "directPaymentId" TEXT;
ALTER TABLE "Attendance" ADD COLUMN "directPaymentOperationId" TEXT;
ALTER TABLE "Attendance" ADD COLUMN "directPaymentTariffId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "attendanceLessonId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "attendanceTariffId" TEXT;
ALTER TABLE "PaymentOperation" ADD COLUMN "attendanceLessonId" TEXT;
ALTER TABLE "PaymentOperation" ADD COLUMN "attendanceTariffId" TEXT;

CREATE UNIQUE INDEX "Attendance_directPaymentId_key" ON "Attendance"("directPaymentId");
CREATE UNIQUE INDEX "Attendance_directPaymentOperationId_key" ON "Attendance"("directPaymentOperationId");
