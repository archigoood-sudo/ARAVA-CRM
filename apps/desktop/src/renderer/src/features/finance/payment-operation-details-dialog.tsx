import {
  formatDate,
  t,
  type AqsiGatewayPayment,
  type PaymentDetail,
  type PaymentOperationSummary,
} from '@arava/shared';
import { Badge, Button, Dialog, Money, Receipt } from '@arava/ui';
import { ExternalLink, RefreshCw } from 'lucide-react';

import { canCheckFiscalReceipt, fiscalReceiptLabel } from './payment-operation-details';

function paymentMethod(operation: PaymentOperationSummary, payment?: PaymentDetail): string {
  if (payment) return t(`payment.method.${payment.paymentMethod}`);
  if (operation.providerType === 'ACQUIRING') return t('payment.method.ACQUIRING');
  if (operation.providerType === 'SBP') return t('payment.method.SBP');
  return t('common.notSpecified');
}

const gatewayStatus: Record<AqsiGatewayPayment['status'], string> = {
  CANCELLED: 'Отменена',
  CREATED: 'Создана',
  EXPIRED: 'Истекла',
  FAILED: 'Ошибка',
  PROCESSING: 'Обрабатывается',
  SUCCEEDED: 'Оплата подтверждена',
  WAITING: 'Ожидает оплаты',
};

export function PaymentOperationDetailsDialog({
  busy,
  error,
  gateway,
  onCheck,
  onClose,
  open,
  operation,
  payment,
}: {
  busy: boolean;
  error?: string | undefined;
  gateway?: AqsiGatewayPayment | undefined;
  onCheck: () => void;
  onClose: () => void;
  open: boolean;
  operation?: PaymentOperationSummary | undefined;
  payment?: PaymentDetail | undefined;
}) {
  const fiscal = gateway?.fiscalReceipt;
  return (
    <Dialog
      closeLabel={t('common.closeDialog')}
      onClose={onClose}
      open={open}
      title="Детали оплаты"
    >
      {operation ? (
        <div className="space-y-5">
          <Receipt
            footer={
              <div className="flex items-end justify-between">
                <span className="text-sm text-muted-foreground">Сумма оплаты</span>
                <Money
                  amount={payment?.amount ?? operation.amount}
                  className="text-2xl font-semibold"
                />
              </div>
            }
            rows={[
              { label: t('payment.student'), value: operation.studentName },
              {
                label: t('payment.date'),
                value: formatDate(payment?.paidAt ?? operation.completedAt ?? operation.createdAt, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }),
              },
              { label: t('payment.method'), value: paymentMethod(operation, payment) },
              {
                label: t('payment.status'),
                value: (
                  <Badge>
                    {payment
                      ? t(`payment.status.${payment.status}`)
                      : t(`payment.operation.status.${operation.status}`)}
                  </Badge>
                ),
              },
              ...(gateway
                ? [
                    {
                      label: 'Статус aQsi',
                      value: <Badge>{gatewayStatus[gateway.status]}</Badge>,
                    },
                  ]
                : []),
            ]}
            title={operation.purpose}
          />

          {['SBP', 'ACQUIRING'].includes(operation.providerType) ? (
            <section className="rounded-2xl border border-border bg-muted/30 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Кассовый чек
                  </p>
                  <p className="mt-2 font-semibold">{fiscalReceiptLabel(fiscal)}</p>
                </div>
              </div>
              {fiscal?.message ? (
                <p className="mt-3 text-sm text-muted-foreground">{fiscal.message}</p>
              ) : null}
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                {fiscal?.fiscalDocumentNumber ? (
                  <FiscalDetail
                    label="Фискальный документ"
                    value={String(fiscal.fiscalDocumentNumber)}
                  />
                ) : null}
                {fiscal?.fiscalSign ? (
                  <FiscalDetail label="Фискальный признак" value={fiscal.fiscalSign} />
                ) : null}
                {fiscal?.fiscalStorageNumber ? (
                  <FiscalDetail label="Номер ФН" value={fiscal.fiscalStorageNumber} />
                ) : null}
                {fiscal?.kktRegistrationNumber ? (
                  <FiscalDetail
                    label="Регистрационный номер ККТ"
                    value={fiscal.kktRegistrationNumber}
                  />
                ) : null}
                {fiscal?.kktSerialNumber ? (
                  <FiscalDetail label="Серийный номер ККТ" value={fiscal.kktSerialNumber} />
                ) : null}
                {fiscal?.providerReceiptId ? (
                  <FiscalDetail label="Идентификатор чека" value={fiscal.providerReceiptId} />
                ) : null}
                {fiscal?.completedAt ? (
                  <FiscalDetail
                    label="Дата формирования"
                    value={formatDate(fiscal.completedAt, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  />
                ) : null}
              </dl>
              {fiscal?.receiptUrl ? (
                <a
                  className="mt-4 inline-flex items-center gap-2 text-sm font-medium underline underline-offset-4"
                  href={fiscal.receiptUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Открыть чек
                  <ExternalLink className="size-4" />
                </a>
              ) : null}
            </section>
          ) : null}

          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button onClick={onClose} variant="outline">
              {t('common.close')}
            </Button>
            {canCheckFiscalReceipt(operation, gateway) ? (
              <Button disabled={busy} onClick={onCheck}>
                <RefreshCw className="size-4" />
                Проверить чек
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}

function FiscalDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-all font-medium">{value}</dd>
    </div>
  );
}
