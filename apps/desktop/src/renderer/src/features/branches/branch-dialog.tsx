import { zodResolver } from '@hookform/resolvers/zod';
import { branchInputSchema, type BranchInput, type BranchSummary } from '@arava/shared';
import { Button, Dialog, Input, Label, Textarea } from '@arava/ui';
import { useEffect } from 'react';
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

  useEffect(() => {
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
  }, [branch, open, reset]);

  return (
    <Dialog
      description="Keep branch details accurate for staff and student records."
      onClose={onClose}
      open={open}
      title={branch ? 'Edit branch' : 'Create branch'}
    >
      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
        <div className="space-y-2">
          <Label htmlFor="branch-name">Branch name</Label>
          <Input id="branch-name" {...register('name')} />
          {errors.name ? <p className="text-sm text-red-600">{errors.name.message}</p> : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="branch-address">Address</Label>
          <Input id="branch-address" {...register('address')} />
          {errors.address ? <p className="text-sm text-red-600">{errors.address.message}</p> : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="branch-phone">Phone</Label>
          <Input id="branch-phone" placeholder="+7 999 123-45-67" {...register('phone')} />
          {errors.phone ? <p className="text-sm text-red-600">{errors.phone.message}</p> : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="branch-description">Description</Label>
          <Textarea id="branch-description" {...register('description')} />
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-3 pt-2">
          <Button onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button disabled={isSubmitting} type="submit">
            {isSubmitting ? 'Saving…' : branch ? 'Save branch' : 'Create branch'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
