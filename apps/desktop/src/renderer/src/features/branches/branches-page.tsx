import { t, type BranchInput, type BranchSummary } from '@arava/shared';
import {
  Badge,
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
import { Archive, Building2, MapPin, Pencil, Plus, Phone } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { getDesktopApi } from '../../lib/desktop-api';
import { getErrorMessage } from '../../lib/errors';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';
import { BranchDialog } from './branch-dialog';

export function BranchesPage() {
  const [searchParameters] = useSearchParams();
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
  const search = searchParameters.get('search')?.trim().toLocaleLowerCase('ru-RU');
  const visibleBranches = query.data?.filter(
    (branch) =>
      !search ||
      branch.name.toLocaleLowerCase('ru-RU').includes(search) ||
      branch.address?.toLocaleLowerCase('ru-RU').includes(search),
  );

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
      setMutationError(getErrorMessage(error, t('branch.errorSave')));
    }
  };

  return (
    <main className="mx-auto w-full max-w-[1400px] p-9 pb-14">
      <PageHeader
        action={
          canManage ? (
            <Button onClick={openCreate}>
              <Plus className="size-4" />
              {t('branch.action.create')}
            </Button>
          ) : undefined
        }
        description={t('branch.pageDescription')}
        title={t('branch.pageTitle')}
      />

      <Card className="overflow-hidden">
        {query.isLoading ? <LoadingState label={t('branch.loading')} /> : null}
        {query.isError ? (
          <ErrorState
            message={t('branch.errorLoad')}
            onRetry={() => void query.refetch()}
            retryLabel={t('common.retry')}
            title={t('common.errorTitle')}
          />
        ) : null}
        {visibleBranches?.length === 0 ? (
          <EmptyState
            action={
              canManage ? (
                <Button onClick={openCreate}>{t('branch.action.createFirst')}</Button>
              ) : undefined
            }
            description={t('branch.emptyDescription')}
            icon={Building2}
            title={t('branch.emptyTitle')}
          />
        ) : null}
        {visibleBranches && visibleBranches.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('nav.branches')}</TableHead>
                <TableHead>{t('branch.contact')}</TableHead>
                <TableHead>{t('common.status')}</TableHead>
                <TableHead className="text-right">{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleBranches.map((branch) => (
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
                      {branch.isActive ? t('common.active') : t('common.archived')}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {canManage && branch.isActive ? (
                      <div className="flex justify-end gap-1">
                        <Button
                          aria-label={t('branch.action.editLabel', { name: branch.name })}
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
                          aria-label={t('branch.action.archiveLabel', { name: branch.name })}
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
