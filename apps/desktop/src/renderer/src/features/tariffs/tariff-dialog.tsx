import {
  TARIFF_TYPES,
  tariffInputSchema,
  t,
  type BranchSummary,
  type TariffInput,
  type TariffSummary,
} from '@arava/shared';
import { Button, Checkbox, Dialog, Input, Label, Select, Textarea } from '@arava/ui';
import { useLayoutEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';

const optionalNumber = (value: unknown) =>
  value === '' || value === undefined || Number.isNaN(Number(value)) ? undefined : Number(value);

export function TariffDialog({
  branches,
  canUseGlobal,
  error,
  onClose,
  onSubmit,
  open,
  tariff,
}: {
  branches: BranchSummary[];
  canUseGlobal: boolean;
  error?: string | undefined;
  onClose: () => void;
  onSubmit: (input: TariffInput) => Promise<void>;
  open: boolean;
  tariff: TariffSummary | null;
}) {
  const {
    formState: { isSubmitting },
    handleSubmit,
    register,
    reset,
    watch,
  } = useForm<TariffInput>({
    defaultValues: { currency: 'RUB', isActive: true, name: '', price: 0, type: 'LESSON_PACK' },
  });
  const wasOpen = useRef(false);
  const [validationError, setValidationError] = useState<string>();
  const type = watch('type');

  useLayoutEffect(() => {
    if (open && !wasOpen.current) {
      reset(
        tariff
          ? { ...tariff, price: tariff.price / 100 }
          : {
              branchId: canUseGlobal ? undefined : branches[0]?.id,
              currency: 'RUB',
              freezeDays: 0,
              isActive: true,
              lessonCount: 8,
              name: '',
              price: 0,
              type: 'LESSON_PACK',
              validityDays: 30,
            },
      );
    }
    wasOpen.current = open;
  }, [branches, canUseGlobal, open, reset, tariff]);

  const submit = (values: TariffInput) => {
    const normalized: TariffInput = {
      ...values,
      lessonCount:
        values.type === 'UNLIMITED'
          ? undefined
          : values.type === 'SINGLE_LESSON' || values.type === 'TRIAL'
            ? 1
            : values.lessonCount,
      price: Math.round(values.price * 100),
    };
    const result = tariffInputSchema.safeParse(normalized);
    if (!result.success) {
      setValidationError(result.error.issues[0]?.message ?? t('validation.form'));
      return Promise.resolve();
    }
    setValidationError(undefined);
    return onSubmit(result.data);
  };

  return (
    <Dialog
      closeLabel={t('common.closeDialog')}
      description={t('tariff.dialogDescription')}
      onClose={onClose}
      open={open}
      title={tariff ? t('tariff.updateTitle') : t('tariff.createTitle')}
    >
      <form className="space-y-4" onSubmit={handleSubmit(submit)}>
        <div className="space-y-2">
          <Label htmlFor="tariff-name">{t('tariff.name')}</Label>
          <Input id="tariff-name" {...register('name')} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="tariff-type">{t('tariff.type')}</Label>
            <Select id="tariff-type" {...register('type')}>
              {TARIFF_TYPES.map((item) => (
                <option key={item} value={item}>
                  {t(`tariff.type.${item}`)}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tariff-branch">{t('tariff.branch')}</Label>
            <Select id="tariff-branch" {...register('branchId')}>
              {canUseGlobal ? <option value="">{t('tariff.branch.global')}</option> : null}
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="tariff-price">{t('tariff.price')}</Label>
            <Input
              id="tariff-price"
              min="0"
              step="0.01"
              type="number"
              {...register('price', { valueAsNumber: true })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tariff-validity">{t('tariff.validityDays')}</Label>
            <Input
              id="tariff-validity"
              min="1"
              type="number"
              {...register('validityDays', { setValueAs: optionalNumber })}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="tariff-lessons">{t('tariff.lessonCount')}</Label>
            <Input
              disabled={type !== 'LESSON_PACK'}
              id="tariff-lessons"
              min="1"
              type="number"
              {...register('lessonCount', { setValueAs: optionalNumber })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tariff-freeze">{t('tariff.freezeDays')}</Label>
            <Input
              id="tariff-freeze"
              min="0"
              type="number"
              {...register('freezeDays', { setValueAs: optionalNumber })}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="tariff-description">{t('tariff.description')}</Label>
          <Textarea id="tariff-description" {...register('description')} />
        </div>
        <label className="flex items-center gap-3 rounded-2xl border border-border p-4 text-sm font-medium">
          <Checkbox {...register('isActive')} />
          {t('tariff.status.active')}
        </label>
        <input type="hidden" value="RUB" {...register('currency')} />
        {validationError || error ? (
          <p className="text-sm text-red-600">{validationError ?? error}</p>
        ) : null}
        <div className="flex justify-end gap-3 pt-2">
          <Button onClick={onClose} variant="outline">
            {t('common.cancel')}
          </Button>
          <Button disabled={isSubmitting} type="submit">
            {isSubmitting ? t('common.saving') : t('tariff.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
