import { formatDate, t, type PaymentDetail } from '@arava/shared';
import { Badge, Button, Dialog, Money, Receipt } from '@arava/ui';
import { RotateCcw } from 'lucide-react';

export function PaymentDetailsDialog({
  canRefund,
  onClose,
  onCancel,
  onRefund,
  open,
  payment,
}: {
  canRefund: boolean;
  onCancel: () => void;
  onClose: () => void;
  onRefund: () => void;
  open: boolean;
  payment?: PaymentDetail | undefined;
}) {
  return (
    <Dialog
      closeLabel={t('common.closeDialog')}
      onClose={onClose}
      open={open}
      title={t('payment.details')}
    >
      {payment ? (
        <div className="space-y-5">
          <Receipt
            footer={
              <div className="flex items-end justify-between">
                <span className="text-sm text-muted-foreground">{t('payment.netAmount')}</span>
                <Money amount={payment.netAmount} className="text-2xl font-semibold" />
              </div>
            }
            rows={[
              { label: t('payment.student'), value: payment.studentName },
              { label: t('student.branch'), value: payment.branchName },
              {
                label: t('payment.date'),
                value: formatDate(payment.paidAt, { dateStyle: 'medium', timeStyle: 'short' }),
              },
              { label: t('payment.method'), value: t(`payment.method.${payment.paymentMethod}`) },
              { label: t('payment.amount'), value: <Money amount={payment.amount} /> },
              {
                label: t('payment.status'),
                value: <Badge>{t(`payment.status.${payment.status}`)}</Badge>,
              },
            ]}
            title={t('payment.receipt')}
          />
          {payment.refunds.length ? (
            <section>
              <h3 className="mb-3 text-sm font-semibold">{t('refund.history')}</h3>
              <div className="space-y-2">
                {payment.refunds.map((refund) => (
                  <div className="rounded-xl border border-border p-3 text-sm" key={refund.id}>
                    <div className="flex justify-between">
                      <span className="font-medium">{refund.reason}</span>
                      <Money amount={refund.amount} className="font-semibold text-red-600" />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDate(refund.refundedAt, { dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
                      {refund.createdByName}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          {canRefund &&
          payment.status !== 'CANCELLED' &&
          payment.refundedAmount < payment.amount ? (
            <Button className="w-full" onClick={onRefund} variant="outline">
              <RotateCcw className="size-4" />
              {t('refund.action')}
            </Button>
          ) : null}
          {canRefund && payment.status === 'COMPLETED' && payment.refundedAmount === 0 ? (
            <Button className="w-full" onClick={onCancel} variant="ghost">
              {t('payment.cancel')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}
