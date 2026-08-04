import {
  USER_ROLES,
  t,
  userCreateSchema,
  userUpdateSchema,
  type BranchSummary,
  type UserCreateInput,
  type UserRole,
  type UserSummary,
  type UserUpdateInput,
} from '@arava/shared';
import { Button, Checkbox, Dialog, Input, Label, Select } from '@arava/ui';
import { useLayoutEffect, useRef } from 'react';
import { Controller, useForm } from 'react-hook-form';

const roleLabels: Record<UserRole, string> = {
  ADMIN: t('role.ADMIN'),
  BRANCH_MANAGER: t('role.BRANCH_MANAGER'),
  COACH: t('role.COACH'),
  OWNER: t('role.OWNER'),
};

interface UserFormValues {
  branchIds: string[];
  email: string;
  fullName: string;
  isActive: boolean;
  password: string;
  role: UserRole;
}

export function UserDialog({
  actorRole,
  branches,
  error,
  onClose,
  onCreate,
  onUpdate,
  open,
  user,
}: {
  actorRole: UserRole;
  branches: BranchSummary[];
  error?: string | undefined;
  onClose: () => void;
  onCreate: (input: UserCreateInput) => Promise<void>;
  onUpdate: (input: UserUpdateInput) => Promise<void>;
  open: boolean;
  user: UserSummary | null;
}) {
  const {
    control,
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    reset,
    setError,
    watch,
  } = useForm<UserFormValues>({
    defaultValues: {
      branchIds: [],
      email: '',
      fullName: '',
      isActive: true,
      password: '',
      role: 'COACH',
    },
  });
  const wasOpen = useRef(false);
  const selectedRole = watch('role');
  const scopedRole = selectedRole === 'BRANCH_MANAGER' || selectedRole === 'COACH';

  useLayoutEffect(() => {
    if (open && !wasOpen.current) {
      reset(
        user
          ? {
              branchIds: user.branchIds,
              email: user.email,
              fullName: user.fullName,
              isActive: user.isActive,
              password: '',
              role: user.role,
            }
          : {
              branchIds: [],
              email: '',
              fullName: '',
              isActive: true,
              password: '',
              role: 'COACH',
            },
      );
    }
    wasOpen.current = open;
  }, [open, reset, user]);

  const submit = handleSubmit(async (values) => {
    const branchIds = scopedRole ? values.branchIds : [];
    if (user) {
      const result = userUpdateSchema.safeParse({
        branchIds,
        fullName: values.fullName,
        isActive: values.isActive,
        role: values.role,
      });
      if (!result.success) {
        setError('root', { message: result.error.issues[0]?.message ?? t('user.errorForm') });
        return;
      }
      await onUpdate(result.data);
    } else {
      const result = userCreateSchema.safeParse({
        branchIds,
        email: values.email,
        fullName: values.fullName,
        password: values.password,
        role: values.role,
      });
      if (!result.success) {
        setError('root', { message: result.error.issues[0]?.message ?? t('user.errorForm') });
        return;
      }
      await onCreate(result.data);
    }
  });

  const roleOptions = USER_ROLES.filter((role) => actorRole === 'OWNER' || role !== 'OWNER');
  return (
    <Dialog
      closeLabel={t('common.closeDialog')}
      description={t('user.dialogDescription')}
      onClose={onClose}
      open={open}
      title={user ? t('user.editTitle') : t('user.createTitle')}
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="user-name">{t('user.fullName')}</Label>
            <Input id="user-name" {...register('fullName', { required: true })} />
            {errors.fullName ? (
              <p className="text-sm text-red-600">{t('user.fullNameRequired')}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="user-role">{t('user.role')}</Label>
            <Select id="user-role" {...register('role')}>
              {roleOptions.map((role) => (
                <option key={role} value={role}>
                  {roleLabels[role]}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="user-email">{t('user.email')}</Label>
          <Input
            disabled={Boolean(user)}
            id="user-email"
            type="email"
            {...register('email', { required: !user })}
          />
        </div>
        {!user ? (
          <div className="space-y-2">
            <Label htmlFor="user-password">{t('user.temporaryPassword')}</Label>
            <Input
              id="user-password"
              type="password"
              {...register('password', { required: true })}
            />
            <p className="text-xs text-muted-foreground">{t('user.temporaryPasswordHint')}</p>
          </div>
        ) : null}
        {scopedRole ? (
          <fieldset className="space-y-2 rounded-2xl border border-border p-4">
            <legend className="px-1 text-sm font-semibold">{t('user.assignedBranches')}</legend>
            <Controller
              control={control}
              name="branchIds"
              render={({ field }) => (
                <div className="grid grid-cols-2 gap-2">
                  {branches.map((branch) => (
                    <label
                      className="flex items-center gap-2 rounded-xl bg-background px-3 py-2.5 text-sm"
                      key={branch.id}
                    >
                      <Checkbox
                        checked={field.value.includes(branch.id)}
                        onChange={(event) =>
                          field.onChange(
                            event.target.checked
                              ? [...field.value, branch.id]
                              : field.value.filter((id) => id !== branch.id),
                          )
                        }
                      />
                      {branch.name}
                    </label>
                  ))}
                </div>
              )}
            />
          </fieldset>
        ) : null}
        {user ? (
          <label className="flex items-center gap-2 text-sm font-medium">
            <Checkbox {...register('isActive')} /> {t('user.accountEnabled')}
          </label>
        ) : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        {errors.root ? <p className="text-sm text-red-600">{errors.root.message}</p> : null}
        <div className="flex justify-end gap-3 pt-2">
          <Button onClick={onClose} variant="outline">
            {t('common.cancel')}
          </Button>
          <Button disabled={isSubmitting} type="submit">
            {isSubmitting ? t('common.saving') : user ? t('user.saveAccess') : t('user.action.add')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
