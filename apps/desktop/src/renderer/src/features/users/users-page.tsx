import { t, type UserCreateInput, type UserSummary, type UserUpdateInput } from '@arava/shared';
import {
  Badge,
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@arava/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, ShieldCheck, Users } from 'lucide-react';
import { useState } from 'react';

import { getDesktopApi } from '../../lib/desktop-api';
import { getErrorMessage } from '../../lib/errors';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';
import { UserDialog } from './user-dialog';

const roleNames = {
  ADMIN: t('role.ADMIN'),
  BRANCH_MANAGER: t('role.BRANCH_MANAGER'),
  COACH: t('role.COACH'),
  OWNER: t('role.OWNER'),
} as const;

export function UsersPage() {
  const actor = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<UserSummary | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
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

  const finish = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.users });
    setOpen(false);
  };
  const createUser = async (input: UserCreateInput) => {
    setError(undefined);
    try {
      await create.mutateAsync(input);
      await finish();
    } catch (caught) {
      setError(getErrorMessage(caught, t('user.errorCreate')));
    }
  };
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
                <TableHead className="text-right">{t('common.action')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.data.map((user) => {
                const protectedOwner = actor.role === 'ADMIN' && user.role === 'OWNER';
                return (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar name={user.fullName} size="small" />
                        <div>
                          <p className="font-semibold">{user.fullName}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{user.email}</p>
                        </div>
                      </div>
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
    </main>
  );
}
