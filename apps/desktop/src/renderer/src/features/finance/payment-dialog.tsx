import {
  PAYMENT_METHODS,
  paymentInputSchema,
  t,
  type BranchSummary,
  type PaymentInput,
  type StudentSummary,
  type SubscriptionSummary,
} from '@arava/shared';
import { Button, Dialog, Input, Label, Select, Textarea } from '@arava/ui';
import { useLayoutEffect, useState } from 'react';
import { useForm } from 'react-hook-form';

function localDateTimeValue(value = new Date()): string {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

export function PaymentDialog({
  branches,
  error,
  fixedStudent,
  onClose,
  onSubmit,
  open,
  students,
  subscriptions = [],
}: {
  branches: BranchSummary[];
  error?: string | undefined;
  fixedStudent?: StudentSummary | undefined;
  onClose: () => void;
  onSubmit: (input: PaymentInput) => Promise<void>;
  open: boolean;
  students: StudentSummary[];
  subscriptions?: SubscriptionSummary[] | undefined;
}) {
  const {
    formState: { isSubmitting },
    handleSubmit,
    register,
    reset,
  } = useForm<PaymentInput>({
    defaultValues: {
      amount: 0,
      branchId: '',
      paidAt: new Date().toISOString(),
      paymentMethod: 'CASH',
      studentId: '',
    },
  });
  const [validationError, setValidationError] = useState<string>();
  useLayoutEffect(() => {
    if (!open) return;
    reset({
      amount: 0,
      branchId: fixedStudent?.branchId ?? branches[0]?.id ?? '',
      paidAt: localDateTimeValue(),
      paymentMethod: 'CASH',
      studentId: fixedStudent?.id ?? '',
    });
  }, [branches, fixedStudent, open, reset]);

  return (
    <Dialog
      closeLabel={t('common.closeDialog')}
      description={t('payment.createDescription')}
      onClose={onClose}
      open={open}
      title={t('payment.createTitle')}
    >
      <form
        className="space-y-4"
        onSubmit={handleSubmit(async (values) => {
          const result = paymentInputSchema.safeParse({
            ...values,
            amount: Math.round(values.amount * 100),
            paidAt: new Date(values.paidAt).toISOString(),
          });
          if (!result.success) {
            setValidationError(result.error.issues[0]?.message ?? t('validation.form'));
            return;
          }
          setValidationError(undefined);
          await onSubmit(result.data);
        })}
      >
        <div className="space-y-2">
          <Label htmlFor="payment-student">{t('payment.student')}</Label>
          {fixedStudent ? (
            <>
              <Select disabled id="payment-student" value={fixedStudent.id}>
                <option value={fixedStudent.id}>
                  {fixedStudent.lastName} {fixedStudent.firstName}
                </option>
              </Select>
              <input type="hidden" {...register('studentId')} />
            </>
          ) : (
            <Select id="payment-student" {...register('studentId')}>
              <option value="">{t('common.notSpecified')}</option>
              {students.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.lastName} {student.firstName}
                </option>
              ))}
            </Select>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="payment-branch">{t('student.branch')}</Label>
            {fixedStudent ? (
              <>
                <Select disabled id="payment-branch" value={fixedStudent.branchId}>
                  <option value={fixedStudent.branchId}>{fixedStudent.branchName}</option>
                </Select>
                <input type="hidden" {...register('branchId')} />
              </>
            ) : (
              <Select id="payment-branch" {...register('branchId')}>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </Select>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="payment-subscription">{t('payment.subscription')}</Label>
            <Select id="payment-subscription" {...register('subscriptionId')}>
              <option value="">{t('payment.subscription.none')}</option>
              {subscriptions
                .filter(({ debt }) => debt > 0)
                .map((subscription) => (
                  <option key={subscription.id} value={subscription.id}>
                    {subscription.tariffName}
                  </option>
                ))}
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="payment-amount">{t('payment.amount')}</Label>
            <Input
              id="payment-amount"
              min="0.01"
              step="0.01"
              type="number"
              {...register('amount', { valueAsNumber: true })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="payment-method">{t('payment.method')}</Label>
            <Select id="payment-method" {...register('paymentMethod')}>
              {PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {t(`payment.method.${method}`)}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="payment-date">{t('payment.date')}</Label>
          <Input id="payment-date" type="datetime-local" {...register('paidAt')} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="payment-reference">{t('payment.externalReference')}</Label>
          <Input id="payment-reference" {...register('externalReference')} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="payment-comment">{t('payment.comment')}</Label>
          <Textarea id="payment-comment" {...register('comment')} />
        </div>
        {validationError || error ? (
          <p className="text-sm text-red-600">{validationError ?? error}</p>
        ) : null}
        <div className="flex justify-end gap-3 pt-2">
          <Button onClick={onClose} variant="outline">
            {t('common.cancel')}
          </Button>
          <Button disabled={isSubmitting} type="submit">
            {isSubmitting ? t('common.saving') : t('payment.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
