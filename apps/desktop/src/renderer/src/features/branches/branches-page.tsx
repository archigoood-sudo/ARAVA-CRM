import type { BranchInput, BranchSummary } from '@arava/shared';
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
import { Archive, Building2, MapPin, Pencil, Plus, Phone } from 'lucide-react';
import { useState } from 'react';

import { getDesktopApi } from '../../lib/desktop-api';
import { getErrorMessage } from '../../lib/errors';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';
import { BranchDialog } from './branch-dialog';

export function BranchesPage() {
  const user = useAuthStore((state) => state.user);
  const canManage = user?.role === 'OWNER' || user?.role === 'ADMIN';
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BranchSummary | null>(null);
  const [mutationError, setMutationError] = useState<string>();
  const query = useQuery({
    queryFn: () => getDesktopApi().branches.list(getSessionToken(), canManage),
    queryKey: queryKeys.branches(canManage),
  });
  const save = useMutation({
    mutationFn: (input: BranchInput) =>
      editing
        ? getDesktopApi().branches.update(getSessionToken(), editing.id, input)
        : getDesktopApi().branches.create(getSessionToken(), input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['branches'] });
      setDialogOpen(false);
    },
  });
  const archive = useMutation({
    mutationFn: (id: string) => getDesktopApi().branches.archive(getSessionToken(), id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['branches'] }),
  });

  const openCreate = () => {
    setEditing(null);
    setMutationError(undefined);
    setDialogOpen(true);
  };
  const submit = async (input: BranchInput) => {
    setMutationError(undefined);
    try {
      await save.mutateAsync(input);
    } catch (error) {
      setMutationError(getErrorMessage(error, 'The branch could not be saved.'));
    }
  };

  return (
    <main className="mx-auto w-full max-w-[1400px] p-9 pb-14">
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h2 className="text-4xl font-semibold tracking-[-0.045em]">Your studio network.</h2>
          <p className="mt-2.5 text-base text-muted-foreground">
            Keep locations organized and control branch-level access.
          </p>
        </div>
        {canManage ? (
          <Button onClick={openCreate}>
            <Plus className="size-4" />
            Create branch
          </Button>
        ) : null}
      </div>

      <Card className="overflow-hidden">
        {query.isLoading ? <LoadingState label="Loading branches…" /> : null}
        {query.isError ? (
          <ErrorState
            message="Branches could not be loaded."
            onRetry={() => void query.refetch()}
          />
        ) : null}
        {query.data?.length === 0 ? (
          <EmptyState
            action={
              canManage ? <Button onClick={openCreate}>Create first branch</Button> : undefined
            }
            description="Create a studio branch before adding students or assigning staff."
            icon={Building2}
            title="No branches yet"
          />
        ) : null}
        {query.data && query.data.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Branch</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.map((branch) => (
                <TableRow key={branch.id}>
                  <TableCell>
                    <p className="font-semibold">{branch.name}</p>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <MapPin className="size-3" />
                      {branch.address}
                    </p>
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <Phone className="size-3.5" />
                      {branch.phone}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={branch.isActive ? undefined : 'bg-muted text-muted-foreground'}
                    >
                      {branch.isActive ? 'Active' : 'Archived'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {canManage && branch.isActive ? (
                      <div className="flex justify-end gap-1">
                        <Button
                          aria-label={`Edit ${branch.name}`}
                          onClick={() => {
                            setEditing(branch);
                            setMutationError(undefined);
                            setDialogOpen(true);
                          }}
                          size="icon"
                          variant="ghost"
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          aria-label={`Archive ${branch.name}`}
                          disabled={archive.isPending}
                          onClick={() => void archive.mutateAsync(branch.id)}
                          size="icon"
                          variant="ghost"
                        >
                          <Archive className="size-4" />
                        </Button>
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </Card>
      <BranchDialog
        branch={editing}
        error={mutationError}
        onClose={() => setDialogOpen(false)}
        onSubmit={submit}
        open={dialogOpen}
      />
    </main>
  );
}
