import {
  formatDate,
  t,
  type TemporaryPasswordResult,
  type UserCreateInput,
  type UserSummary,
  type UserUpdateInput,
  type UserRole,
} from '@arava/shared';
import {
  Badge,
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Dialog,
  Input,
  LoadingState,
  PageHeader,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@arava/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, LogOut, Pencil, Plus, Search, ShieldCheck, Users } from 'lucide-react';
import { useMemo, useState } from 'react';

import { getDesktopApi } from '../../lib/desktop-api';
import { getErrorMessage } from '../../lib/errors';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';
import { UserDialog } from './user-dialog';

const roleNames = {
  ADMIN: t('role.ADMIN'),
  COACH: t('role.COACH'),
  OWNER: t('role.OWNER'),
} as const;

export function UsersPage() {
  const actor = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<UserSummary | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | UserRole>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [temporary, setTemporary] = useState<TemporaryPasswordResult>();
  const users = useQuery({
    queryFn: () => getDesktopApi().users.list(getSessionToken()),
    queryKey: queryKeys.users,
  });
  const branches = useQuery({
    queryFn: () => getDesktopApi().branches.list(getSessionToken()),
    queryKey: queryKeys.branches(),
  });
  const create = useMutation({
    mutationFn: (input: UserCreateInput) => getDesktopApi().users.create(getSessionToken(), input),
  });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UserUpdateInput }) =>
      getDesktopApi().users.update(getSessionToken(), id, input),
  });
  const resetPassword = useMutation({
    mutationFn: (id: string) => getDesktopApi().users.resetPassword(getSessionToken(), id),
  });
  const revokeSessions = useMutation({
    mutationFn: (id: string) => getDesktopApi().users.revokeSessions(getSessionToken(), id),
  });

  const finish = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.users });
    setOpen(false);
  };
  const createUser = async (input: UserCreateInput) => {
    setError(undefined);
    try {
      const result = await create.mutateAsync(input);
      setTemporary(result);
      await finish();
    } catch (caught) {
      setError(getErrorMessage(caught, t('user.errorCreate')));
    }
  };
  const visibleUsers = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase('ru-RU');
    return (users.data ?? []).filter(
      (user) =>
        (roleFilter === 'ALL' || user.role === roleFilter) &&
        (statusFilter === 'ALL' || user.isActive === (statusFilter === 'ACTIVE')) &&
        (!normalized ||
          [user.fullName, user.email, user.phone ?? ''].some((value) =>
            value.toLocaleLowerCase('ru-RU').includes(normalized),
          )),
    );
  }, [roleFilter, search, statusFilter, users.data]);
  const updateUser = async (input: UserUpdateInput) => {
    if (!editing) return;
    setError(undefined);
    try {
      await update.mutateAsync({ id: editing.id, input });
      await finish();
    } catch (caught) {
      setError(getErrorMessage(caught, t('user.errorUpdate')));
    }
  };
  if (!actor || (actor.role !== 'OWNER' && actor.role !== 'ADMIN')) return null;

  return (
    <main className="mx-auto w-full max-w-[1400px] p-9 pb-14">
      <PageHeader
        action={
          <Button
            onClick={() => {
              setEditing(null);
              setError(undefined);
              setOpen(true);
            }}
          >
            <Plus className="size-4" />
            {t('user.action.add')}
          </Button>
        }
        description={t('user.pageDescription')}
        title={t('user.pageTitle')}
      />
      <Card className="overflow-hidden">
        <div className="flex gap-3 border-b border-border p-4">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-10"
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('user.searchPlaceholder')}
              value={search}
            />
          </div>
          <Select
            aria-label={t('user.roleFilter')}
            onChange={(event) => setRoleFilter(event.target.value as 'ALL' | UserRole)}
            value={roleFilter}
          >
            <option value="ALL">{t('user.allRoles')}</option>
            {(Object.keys(roleNames) as UserRole[]).map((role) => (
              <option key={role} value={role}>
                {roleNames[role]}
              </option>
            ))}
          </Select>
          <Select
            aria-label={t('user.statusFilter')}
            onChange={(event) =>
              setStatusFilter(event.target.value as 'ALL' | 'ACTIVE' | 'INACTIVE')
            }
            value={statusFilter}
          >
            <option value="ALL">{t('user.allStatuses')}</option>
            <option value="ACTIVE">{t('user.status.enabled')}</option>
            <option value="INACTIVE">{t('user.status.disabled')}</option>
          </Select>
        </div>
        {users.isLoading ? <LoadingState label={t('user.loading')} /> : null}
        {users.isError ? (
          <ErrorState
            message={t('user.errorLoad')}
            onRetry={() => void users.refetch()}
            retryLabel={t('common.retry')}
            title={t('common.errorTitle')}
          />
        ) : null}
        {users.data?.length === 0 ? (
          <EmptyState
            description={t('user.emptyDescription')}
            icon={Users}
            title={t('user.emptyTitle')}
          />
        ) : null}
        {users.data && users.data.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('nav.users')}</TableHead>
                <TableHead>{t('user.role')}</TableHead>
                <TableHead>{t('user.branches')}</TableHead>
                <TableHead>{t('user.status')}</TableHead>
                <TableHead>{t('user.security')}</TableHead>
                <TableHead className="text-right">{t('common.action')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleUsers.map((user) => {
                const protectedOwner = actor.role === 'ADMIN' && user.role !== 'COACH';
                return (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar name={user.fullName} size="small" />
                        <div>
                          <p className="font-semibold">{user.fullName}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{user.email}</p>
                          {user.phone ? (
                            <p className="mt-0.5 text-xs text-muted-foreground">{user.phone}</p>
                          ) : null}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <p>
                        {user.lastLoginAt
                          ? t('user.lastLoginValue', {
                              date: formatDate(user.lastLoginAt, {
                                dateStyle: 'short',
                                timeStyle: 'short',
                              }),
                            })
                          : t('user.neverLoggedIn')}
                      </p>
                      {user.mustChangePassword ? (
                        <p className="mt-1 font-medium text-amber-700">
                          {t('user.passwordChangeRequired')}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <ShieldCheck className="size-4 text-muted-foreground" />
                        {roleNames[user.role]}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {user.branchIds.length > 0
                        ? t('user.totalAssignedBranches', { count: user.branchIds.length })
                        : t('user.allBranches')}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={user.isActive ? undefined : 'bg-muted text-muted-foreground'}
                      >
                        {user.isActive ? t('user.status.enabled') : t('user.status.disabled')}
                      </Badge>
                      {user.lockedUntil ? (
                        <Badge className="ml-2 bg-red-50 text-red-700">
                          {t('user.status.locked')}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        aria-label={t('user.action.editLabel', { name: user.fullName })}
                        disabled={protectedOwner}
                        onClick={() => {
                          setEditing(user);
                          setError(undefined);
                          setOpen(true);
                        }}
                        size="icon"
                        variant="ghost"
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        aria-label={t('user.action.resetPassword')}
                        disabled={protectedOwner || resetPassword.isPending}
                        onClick={() => {
                          if (
                            window.confirm(t('user.confirmResetPassword', { name: user.fullName }))
                          )
                            void resetPassword.mutateAsync(user.id).then(setTemporary);
                        }}
                        size="icon"
                        variant="ghost"
                      >
                        <KeyRound className="size-4" />
                      </Button>
                      <Button
                        aria-label={t('user.action.revokeSessions')}
                        disabled={protectedOwner || revokeSessions.isPending}
                        onClick={() => {
                          if (
                            window.confirm(t('user.confirmRevokeSessions', { name: user.fullName }))
                          )
                            void revokeSessions.mutateAsync(user.id);
                        }}
                        size="icon"
                        variant="ghost"
                      >
                        <LogOut className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : null}
      </Card>
      <UserDialog
        actorRole={actor.role}
        branches={branches.data ?? []}
        error={error}
        onClose={() => setOpen(false)}
        onCreate={createUser}
        onUpdate={updateUser}
        open={open}
        user={editing}
      />
      <Dialog
        closeLabel={t('common.closeDialog')}
        description={t('user.temporaryPasswordOnce')}
        onClose={() => setTemporary(undefined)}
        open={Boolean(temporary)}
        title={t('user.temporaryPasswordTitle')}
      >
        <p className="text-sm text-muted-foreground">
          {temporary?.user.fullName} · {temporary?.user.email}
        </p>
        <code className="mt-5 block select-all rounded-2xl bg-sidebar p-5 text-center text-lg font-semibold tracking-wider text-accent">
          {temporary?.temporaryPassword}
        </code>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Button
            onClick={() => {
              if (temporary) void navigator.clipboard.writeText(temporary.temporaryPassword);
            }}
            variant="outline"
          >
            {t('user.copyPassword')}
          </Button>
          <Button onClick={() => setTemporary(undefined)}>{t('common.close')}</Button>
        </div>
      </Dialog>
    </main>
  );
}
