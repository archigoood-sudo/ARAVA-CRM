import {
  TARIFF_TYPES,
  t,
  type TariffInput,
  type TariffListQuery,
  type TariffSummary,
  type TariffType,
} from '@arava/shared';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Money,
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
import { Archive, CreditCard, Pencil, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import { getDesktopApi } from '../../lib/desktop-api';
import { getErrorMessage } from '../../lib/errors';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';
import { TariffDialog } from './tariff-dialog';

export function TariffsPage() {
  const user = useAuthStore((state) => state.user);
  const canManage = user?.role !== 'COACH';
  const canUseGlobal = user?.role === 'OWNER' || user?.role === 'ADMIN';
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [branchId, setBranchId] = useState('');
  const [type, setType] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TariffSummary | null>(null);
  const [error, setError] = useState<string>();
  const query = useMemo<TariffListQuery>(
    () => ({
      branchId: branchId || undefined,
      includeArchived: canManage,
      search,
      type: (type || undefined) as TariffType | undefined,
    }),
    [branchId, canManage, search, type],
  );
  const tariffs = useQuery({
    queryFn: () => getDesktopApi().tariffs.list(getSessionToken(), query),
    queryKey: queryKeys.tariffs(query),
  });
  const branches = useQuery({
    queryFn: () => getDesktopApi().branches.list(getSessionToken()),
    queryKey: queryKeys.branches(),
  });
  const save = useMutation({
    mutationFn: (input: TariffInput) =>
      editing
        ? getDesktopApi().tariffs.update(getSessionToken(), editing.id, input)
        : getDesktopApi().tariffs.create(getSessionToken(), input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['tariffs'] });
      setDialogOpen(false);
    },
  });
  const archive = useMutation({
    mutationFn: (id: string) => getDesktopApi().tariffs.archive(getSessionToken(), id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tariffs'] }),
  });
  const submit = async (input: TariffInput) => {
    setError(undefined);
    try {
      await save.mutateAsync(input);
    } catch (caught) {
      setError(getErrorMessage(caught, t('tariff.errorSave')));
    }
  };
  const openCreate = () => {
    setEditing(null);
    setError(undefined);
    setDialogOpen(true);
  };

  return (
    <main className="mx-auto w-full max-w-[1460px] animate-fade-in p-9 pb-14">
      <PageHeader
        action={
          canManage ? (
            <Button onClick={openCreate}>
              <Plus className="size-4" />
              {t('tariff.action.add')}
            </Button>
          ) : undefined
        }
        description={t('tariff.pageDescription')}
        title={t('tariff.pageTitle')}
      />
      <Card className="mb-5 grid grid-cols-[minmax(260px,1fr)_240px_240px] gap-3 p-4">
        <label className="relative">
          <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label={t('tariff.search')}
            className="pl-10"
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('tariff.search')}
            value={search}
          />
        </label>
        <Select
          aria-label={t('tariff.branch')}
          onChange={(event) => setBranchId(event.target.value)}
          value={branchId}
        >
          <option value="">{t('tariff.allBranches')}</option>
          {branches.data?.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('tariff.type')}
          onChange={(event) => setType(event.target.value)}
          value={type}
        >
          <option value="">{t('tariff.allTypes')}</option>
          {TARIFF_TYPES.map((item) => (
            <option key={item} value={item}>
              {t(`tariff.type.${item}`)}
            </option>
          ))}
        </Select>
      </Card>
      <Card className="overflow-hidden">
        {tariffs.isLoading ? <LoadingState label={t('common.loading')} /> : null}
        {tariffs.isError ? (
          <ErrorState
            message={t('tariff.errorLoad')}
            onRetry={() => void tariffs.refetch()}
            retryLabel={t('common.retry')}
            title={t('common.errorTitle')}
          />
        ) : null}
        {tariffs.data?.length === 0 ? (
          <EmptyState
            action={
              canManage ? (
                <Button onClick={openCreate}>{t('tariff.action.first')}</Button>
              ) : undefined
            }
            description={t('tariff.emptyDescription')}
            icon={CreditCard}
            title={t('tariff.emptyTitle')}
          />
        ) : null}
        {tariffs.data?.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('tariff.name')}</TableHead>
                <TableHead>{t('tariff.branch')}</TableHead>
                <TableHead>{t('tariff.lessonCount')}</TableHead>
                <TableHead>{t('tariff.price')}</TableHead>
                <TableHead>{t('common.status')}</TableHead>
                <TableHead className="text-right">{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tariffs.data.map((tariff) => (
                <TableRow key={tariff.id}>
                  <TableCell>
                    <p className="font-semibold">{tariff.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t(`tariff.type.${tariff.type}`)}
                    </p>
                  </TableCell>
                  <TableCell>{tariff.branchName ?? t('tariff.branch.global')}</TableCell>
                  <TableCell>
                    {tariff.type === 'UNLIMITED'
                      ? t('tariff.type.UNLIMITED')
                      : (tariff.lessonCount ?? t('common.notSpecified'))}
                  </TableCell>
                  <TableCell>
                    <Money
                      amount={tariff.price}
                      className="font-semibold"
                      currency={tariff.currency}
                    />
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={
                        !tariff.isActive || tariff.archivedAt
                          ? 'bg-muted text-muted-foreground'
                          : undefined
                      }
                    >
                      {tariff.isActive && !tariff.archivedAt
                        ? t('common.active')
                        : t('common.archived')}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {canManage && !tariff.archivedAt ? (
                        <>
                          <Button
                            aria-label={t('tariff.action.edit')}
                            onClick={() => {
                              setEditing(tariff);
                              setError(undefined);
                              setDialogOpen(true);
                            }}
                            size="icon"
                            variant="ghost"
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            aria-label={t('tariff.action.archive')}
                            disabled={archive.isPending}
                            onClick={() => void archive.mutateAsync(tariff.id)}
                            size="icon"
                            variant="ghost"
                          >
                            <Archive className="size-4" />
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </Card>
      <TariffDialog
        branches={branches.data ?? []}
        canUseGlobal={canUseGlobal}
        error={error}
        onClose={() => setDialogOpen(false)}
        onSubmit={submit}
        open={dialogOpen}
        tariff={editing}
      />
    </main>
  );
}
