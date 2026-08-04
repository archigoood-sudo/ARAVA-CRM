import { zodResolver } from '@hookform/resolvers/zod';
import { branchInputSchema, t, type BranchInput, type BranchSummary } from '@arava/shared';
import { Button, Dialog, Input, Label, Textarea } from '@arava/ui';
import { useLayoutEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';

export function BranchDialog({
  branch,
  error,
  onClose,
  onSubmit,
  open,
}: {
  branch: BranchSummary | null;
  error?: string | undefined;
  onClose: () => void;
  onSubmit: (input: BranchInput) => Promise<void>;
  open: boolean;
}) {
  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    reset,
  } = useForm<BranchInput>({
    defaultValues: { address: '', description: '', name: '', phone: '' },
    resolver: zodResolver(branchInputSchema),
  });
  const wasOpen = useRef(false);

  useLayoutEffect(() => {
    if (open && !wasOpen.current) {
      reset(
        branch
          ? {
              address: branch.address,
              description: branch.description ?? '',
              name: branch.name,
              phone: branch.phone,
            }
          : { address: '', description: '', name: '', phone: '' },
      );
    }
    wasOpen.current = open;
  }, [branch, open, reset]);

  return (
    <Dialog
      closeLabel={t('common.closeDialog')}
      description={t('branch.dialogDescription')}
      onClose={onClose}
      open={open}
      title={branch ? t('branch.editTitle') : t('branch.createTitle')}
    >
      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
        <div className="space-y-2">
          <Label htmlFor="branch-name">{t('branch.name')}</Label>
          <Input id="branch-name" {...register('name')} />
          {errors.name ? <p className="text-sm text-red-600">{errors.name.message}</p> : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="branch-address">{t('branch.address')}</Label>
          <Input id="branch-address" {...register('address')} />
          {errors.address ? <p className="text-sm text-red-600">{errors.address.message}</p> : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="branch-phone">{t('branch.phone')}</Label>
          <Input id="branch-phone" placeholder="+7 999 123-45-67" {...register('phone')} />
          {errors.phone ? <p className="text-sm text-red-600">{errors.phone.message}</p> : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="branch-description">{t('branch.description')}</Label>
          <Textarea id="branch-description" {...register('description')} />
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-3 pt-2">
          <Button onClick={onClose} variant="outline">
            {t('common.cancel')}
          </Button>
          <Button disabled={isSubmitting} type="submit">
            {isSubmitting
              ? t('common.saving')
              : branch
                ? t('branch.save')
                : t('branch.action.create')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
