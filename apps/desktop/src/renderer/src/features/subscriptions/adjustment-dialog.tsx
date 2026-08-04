import {
  subscriptionAdjustmentInputSchema,
  t,
  type SubscriptionAdjustmentInput,
} from '@arava/shared';
import { Button, Dialog, Input, Label, Textarea } from '@arava/ui';
import { useEffect, useState } from 'react';

export function AdjustmentDialog({
  error,
  onClose,
  onSubmit,
  open,
}: {
  error?: string | undefined;
  onClose: () => void;
  onSubmit: (input: SubscriptionAdjustmentInput) => Promise<void>;
  open: boolean;
}) {
  const [lessonDelta, setLessonDelta] = useState(0);
  const [comment, setComment] = useState('');
  const [validation, setValidation] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    if (open) {
      setLessonDelta(0);
      setComment('');
      setValidation(undefined);
    }
  }, [open]);
  const submit = async () => {
    const result = subscriptionAdjustmentInputSchema.safeParse({ comment, lessonDelta });
    if (!result.success) {
      setValidation(result.error.issues[0]?.message);
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(result.data);
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <Dialog
      closeLabel={t('common.closeDialog')}
      onClose={onClose}
      open={open}
      title={t('subscription.adjustment')}
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="adjustment-lessons">{t('subscription.adjustmentDelta')}</Label>
          <Input
            id="adjustment-lessons"
            onChange={(event) => setLessonDelta(Number(event.target.value))}
            type="number"
            value={lessonDelta}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="adjustment-reason">{t('subscription.adjustmentReason')}</Label>
          <Textarea
            id="adjustment-reason"
            onChange={(event) => setComment(event.target.value)}
            value={comment}
          />
        </div>
        {validation || error ? <p className="text-sm text-red-600">{validation ?? error}</p> : null}
        <div className="flex justify-end gap-3">
          <Button onClick={onClose} variant="outline">
            {t('common.cancel')}
          </Button>
          <Button disabled={submitting} onClick={() => void submit()}>
            {submitting ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
