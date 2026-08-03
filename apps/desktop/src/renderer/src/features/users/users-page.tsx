import type { UserCreateInput, UserSummary, UserUpdateInput } from '@arava/shared';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
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
  ADMIN: 'Administrator',
  BRANCH_MANAGER: 'Branch manager',
  COACH: 'Coach',
  OWNER: 'Owner',
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
      setError(getErrorMessage(caught, 'User could not be created.'));
    }
  };
  const updateUser = async (input: UserUpdateInput) => {
    if (!editing) return;
    setError(undefined);
    try {
      await update.mutateAsync({ id: editing.id, input });
      await finish();
    } catch (caught) {
      setError(getErrorMessage(caught, 'User could not be updated.'));
    }
  };
  if (!actor || (actor.role !== 'OWNER' && actor.role !== 'ADMIN')) return null;

  return (
    <main className="mx-auto w-full max-w-[1400px] p-9 pb-14">
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h2 className="text-4xl font-semibold tracking-[-0.045em]">People and access.</h2>
          <p className="mt-2.5 text-base text-muted-foreground">
            Local accounts, roles, and branch assignments in one secure place.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setError(undefined);
            setOpen(true);
          }}
        >
          <Plus className="size-4" />
          Add user
        </Button>
      </div>
      <Card className="overflow-hidden">
        {users.isLoading ? <LoadingState label="Loading users…" /> : null}
        {users.isError ? (
          <ErrorState message="Users could not be loaded." onRetry={() => void users.refetch()} />
        ) : null}
        {users.data?.length === 0 ? (
          <EmptyState
            description="Add staff accounts and grant only the access they need."
            icon={Users}
            title="No users"
          />
        ) : null}
        {users.data && users.data.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Branches</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.data.map((user) => {
                const protectedOwner = actor.role === 'ADMIN' && user.role === 'OWNER';
                return (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <span className="flex size-9 items-center justify-center rounded-xl bg-neutral-900 text-xs font-bold text-white dark:bg-accent dark:text-neutral-950">
                          {user.fullName.charAt(0)}
                        </span>
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
                        ? `${String(user.branchIds.length)} assigned`
                        : 'All branches'}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={user.isActive ? undefined : 'bg-muted text-muted-foreground'}
                      >
                        {user.isActive ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        aria-label={`Edit ${user.fullName}`}
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
