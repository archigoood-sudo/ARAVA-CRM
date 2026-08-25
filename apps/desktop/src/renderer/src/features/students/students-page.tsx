import {
  STUDENT_STATUSES,
  formatDate,
  t,
  type StudentInput,
  type StudentBulkAction,
  type StudentBulkExecutionResult,
  type StudentListQuery,
  type StudentStatus,
} from '@arava/shared';
import {
  Badge,
  Avatar,
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorState,
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
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArrowRightLeft,
  ArrowDownUp,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  UserMinus,
  UserPlus,
  UsersRound,
  X,
} from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Link } from 'react-router-dom';

import { getDesktopApi } from '../../lib/desktop-api';
import { getErrorMessage } from '../../lib/errors';
import { invalidateStudentIdentityCaches } from '../../lib/operational-cache';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';
import { StudentDialog } from './student-dialog';
import { StudentBulkDialog } from './student-bulk-dialog';

const statusLabels: Record<StudentStatus, string> = {
  ACTIVE: t('status.ACTIVE'),
  ARCHIVED: t('status.ARCHIVED'),
  FROZEN: t('status.FROZEN'),
  LEFT: t('status.LEFT'),
  TRIAL: t('status.TRIAL'),
};
const statusStyles: Record<StudentStatus, string> = {
  ACTIVE: '',
  ARCHIVED: 'bg-muted text-muted-foreground',
  FROZEN: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300',
  LEFT: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300',
  TRIAL: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
};

export function StudentsPage() {
  const user = useAuthStore((state) => state.user);
  const canManage = user?.role === 'OWNER' || user?.role === 'ADMIN';
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [branchId, setBranchId] = useState('');
  const [status, setStatus] = useState<StudentStatus | ''>('');
  const [sortBy, setSortBy] = useState<StudentListQuery['sortBy']>('name');
  const [sortDirection, setSortDirection] = useState<StudentListQuery['sortDirection']>('asc');
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkAction, setBulkAction] = useState<StudentBulkAction>();
  const [bulkResult, setBulkResult] = useState<string>();
  const [error, setError] = useState<string>();
  const listQuery: StudentListQuery = {
    branchId: branchId || undefined,
    page,
    pageSize: 15,
    search: deferredSearch || undefined,
    sortBy,
    sortDirection,
    status: status || undefined,
  };
  const branches = useQuery({
    queryFn: () => getDesktopApi().branches.list(getSessionToken()),
    queryKey: queryKeys.branches(),
  });
  const students = useQuery({
    placeholderData: keepPreviousData,
    queryFn: () => getDesktopApi().students.list(getSessionToken(), listQuery),
    queryKey: queryKeys.students(listQuery),
  });
  const groups = useQuery({
    enabled: canManage,
    queryFn: () => getDesktopApi().groups.list(getSessionToken(), {}),
    queryKey: queryKeys.groups({}),
  });
  const create = useMutation({
    mutationFn: (input: StudentInput) => getDesktopApi().students.create(getSessionToken(), input),
    onSuccess: (student) => invalidateStudentIdentityCaches(queryClient, student.id),
  });
  const archive = useMutation({
    mutationFn: (id: string) => getDesktopApi().students.archive(getSessionToken(), id),
    onSuccess: (student) => invalidateStudentIdentityCaches(queryClient, student.id),
  });
  const save = async (input: StudentInput) => {
    setError(undefined);
    try {
      await create.mutateAsync(input);
      setDialogOpen(false);
    } catch (caught) {
      setError(getErrorMessage(caught, t('student.errorCreate')));
    }
  };
  const updateFilter = (callback: () => void) => {
    callback();
    setPage(1);
  };
  const visibleIds = students.data?.items.map(({ id }) => id) ?? [];
  const visibleSelectedCount = visibleIds.filter((id) => selectedIds.has(id)).length;
  const allVisibleSelected = visibleIds.length > 0 && visibleSelectedCount === visibleIds.length;
  const hiddenSelectedCount = selectedIds.size - visibleSelectedCount;
  const toggleStudent = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());
  const closeSelection = () => {
    clearSelection();
    setSelectionMode(false);
    setBulkAction(undefined);
  };
  const handleBulkSuccess = async (result: StudentBulkExecutionResult) => {
    const labels: Record<StudentBulkAction, string> = {
      ADD_TO_GROUP: 'В группу добавлено',
      CHANGE_STATUS: 'Статус изменён у',
      MOVE_TO_GROUP: 'В другую группу переведено',
      REMOVE_FROM_GROUP: 'Из группы убрано',
    };
    setBulkResult(`${labels[result.action]} ${String(result.changedCount)} учеников.`);
    setBulkAction(undefined);
    closeSelection();
    await Promise.all([
      invalidateStudentIdentityCaches(queryClient),
      queryClient.invalidateQueries({ queryKey: ['groups'] }),
      queryClient.invalidateQueries({ queryKey: ['attendance'] }),
    ]);
  };

  return (
    <main className="mx-auto w-full max-w-[1500px] p-9 pb-14">
      <PageHeader
        action={
          canManage ? (
            <div className="flex gap-2">
              {!selectionMode ? (
                <Button
                  onClick={() => {
                    setBulkResult(undefined);
                    setSelectionMode(true);
                  }}
                  variant="outline"
                >
                  <CheckSquare className="size-4" />
                  Выбрать
                </Button>
              ) : null}
              <Button
                disabled={(branches.data?.length ?? 0) === 0}
                onClick={() => {
                  setError(undefined);
                  setDialogOpen(true);
                }}
              >
                <Plus className="size-4" />
                {t('student.action.add')}
              </Button>
            </div>
          ) : undefined
        }
        description={t('student.pageDescription')}
        title={t('student.pageTitle')}
      />
      {bulkResult ? (
        <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          {bulkResult}
        </div>
      ) : null}
      {selectionMode ? (
        <Card className="mb-4 flex flex-wrap items-center gap-2 p-3">
          <p className="mr-2 text-sm font-semibold">Выбрано: {selectedIds.size}</p>
          {hiddenSelectedCount > 0 ? (
            <p className="mr-auto text-xs text-muted-foreground">
              Скрыто текущими фильтрами: {hiddenSelectedCount}
            </p>
          ) : (
            <span className="mr-auto" />
          )}
          <Button
            disabled={visibleIds.length === 0}
            onClick={() =>
              setSelectedIds((current) => {
                const next = new Set(current);
                for (const id of visibleIds) next.add(id);
                return next;
              })
            }
            size="small"
            variant="outline"
          >
            Выбрать на этой странице
          </Button>
          <Button
            disabled={selectedIds.size === 0}
            onClick={clearSelection}
            size="small"
            variant="ghost"
          >
            Снять выбор
          </Button>
          <Button
            disabled={selectedIds.size === 0}
            onClick={() => setBulkAction('ADD_TO_GROUP')}
            size="small"
          >
            <UserPlus className="size-4" /> Добавить в группу
          </Button>
          <Button
            disabled={selectedIds.size === 0}
            onClick={() => setBulkAction('MOVE_TO_GROUP')}
            size="small"
            variant="outline"
          >
            <ArrowRightLeft className="size-4" /> Перевести
          </Button>
          <Button
            disabled={selectedIds.size === 0}
            onClick={() => setBulkAction('REMOVE_FROM_GROUP')}
            size="small"
            variant="outline"
          >
            <UserMinus className="size-4" /> Убрать из группы
          </Button>
          <Button
            disabled={selectedIds.size === 0}
            onClick={() => setBulkAction('CHANGE_STATUS')}
            size="small"
            variant="outline"
          >
            Изменить статус
          </Button>
          <Button
            aria-label="Отменить массовый выбор"
            onClick={closeSelection}
            size="icon"
            variant="ghost"
          >
            <X className="size-4" />
          </Button>
        </Card>
      ) : null}
      <Card className="overflow-hidden">
        <div className="grid grid-cols-[minmax(260px,1fr)_220px_180px_180px_44px] gap-3 border-b border-border p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-3.5 size-4 text-muted-foreground" />
            <Input
              aria-label={t('student.searchAria')}
              className="pl-10"
              onChange={(event) => updateFilter(() => setSearch(event.target.value))}
              placeholder={t('student.searchPlaceholder')}
              value={search}
            />
          </div>
          <Select
            aria-label={t('student.filter.branch')}
            onChange={(event) => updateFilter(() => setBranchId(event.target.value))}
            value={branchId}
          >
            <option value="">{t('student.filter.allBranches')}</option>
            {branches.data?.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label={t('student.filter.status')}
            onChange={(event) =>
              updateFilter(() => setStatus(event.target.value as StudentStatus | ''))
            }
            value={status}
          >
            <option value="">{t('student.filter.allStatuses')}</option>
            {STUDENT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {statusLabels[value]}
              </option>
            ))}
          </Select>
          <Select
            aria-label={t('student.sort')}
            onChange={(event) => {
              setSortBy(event.target.value as StudentListQuery['sortBy']);
              setPage(1);
            }}
            value={sortBy}
          >
            <option value="name">{t('student.sort.name')}</option>
            <option value="createdAt">{t('student.sort.createdAt')}</option>
            <option value="birthDate">{t('student.sort.birthDate')}</option>
            <option value="status">{t('student.sort.status')}</option>
          </Select>
          <Button
            aria-label={t('student.sort.direction')}
            onClick={() => setSortDirection((value) => (value === 'asc' ? 'desc' : 'asc'))}
            size="icon"
            variant="outline"
          >
            <ArrowDownUp className="size-4" />
          </Button>
        </div>
        {students.isLoading ? <LoadingState label={t('student.loading')} /> : null}
        {students.isError ? (
          <ErrorState
            message={t('student.errorLoad')}
            onRetry={() => void students.refetch()}
            retryLabel={t('common.retry')}
            title={t('common.errorTitle')}
          />
        ) : null}
        {students.data?.items.length === 0 ? (
          <EmptyState
            action={
              canManage && !search && !status ? (
                <Button onClick={() => setDialogOpen(true)}>{t('student.action.addFirst')}</Button>
              ) : undefined
            }
            description={
              search || status
                ? t('student.emptyFilteredDescription')
                : t('student.emptyDescription')
            }
            icon={UsersRound}
            title={search || status ? t('student.emptyFilteredTitle') : t('student.emptyTitle')}
          />
        ) : null}
        {students.data && students.data.items.length > 0 ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  {selectionMode ? (
                    <TableHead className="w-12">
                      <Checkbox
                        aria-label="Выбрать всех учеников на этой странице"
                        checked={allVisibleSelected}
                        onChange={(event) => {
                          setSelectedIds((current) => {
                            const next = new Set(current);
                            for (const id of visibleIds) {
                              if (event.target.checked) next.add(id);
                              else next.delete(id);
                            }
                            return next;
                          });
                        }}
                      />
                    </TableHead>
                  ) : null}
                  <TableHead>{t('student.pageTitle')}</TableHead>
                  <TableHead>{t('student.branch')}</TableHead>
                  <TableHead>{t('student.phone')}</TableHead>
                  <TableHead>{t('common.status')}</TableHead>
                  <TableHead>{t('student.added')}</TableHead>
                  {canManage ? (
                    <TableHead className="text-right">{t('common.action')}</TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {students.data.items.map((student) => (
                  <TableRow key={student.id}>
                    {selectionMode ? (
                      <TableCell>
                        <Checkbox
                          aria-label={`Выбрать ${student.lastName} ${student.firstName}`}
                          checked={selectedIds.has(student.id)}
                          onChange={() => toggleStudent(student.id)}
                        />
                      </TableCell>
                    ) : null}
                    <TableCell className="py-4">
                      <div className="flex items-center gap-3">
                        <Avatar name={`${student.lastName} ${student.firstName}`} />
                        <div className="min-w-0">
                          <Link
                            className="font-semibold transition hover:text-accent-foreground dark:hover:text-accent"
                            to={`/students/${student.id}`}
                          >
                            {student.lastName} {student.firstName} {student.middleName ?? ''}
                          </Link>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {student.email ?? t('common.notProvided')}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{student.branchName}</TableCell>
                    <TableCell className="text-muted-foreground">{student.phone ?? '—'}</TableCell>
                    <TableCell>
                      <Badge className={statusStyles[student.status]}>
                        {statusLabels[student.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(student.createdAt, {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </TableCell>
                    {canManage && !selectionMode ? (
                      <TableCell className="text-right">
                        <Button
                          aria-label={t('student.action.archiveLabel', {
                            name: `${student.firstName} ${student.lastName}`,
                          })}
                          disabled={archive.isPending || student.status === 'ARCHIVED'}
                          onClick={() => void archive.mutateAsync(student.id)}
                          size="icon"
                          variant="ghost"
                        >
                          <Archive className="size-4" />
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between border-t border-border px-4 py-3">
              <p className="text-sm text-muted-foreground">
                {t('student.total', { count: students.data.total })} ·{' '}
                {t('common.page', {
                  page: students.data.page,
                  pages: students.data.totalPages,
                })}
              </p>
              <div className="flex gap-2">
                <Button
                  disabled={page <= 1}
                  onClick={() => setPage((value) => value - 1)}
                  size="small"
                  variant="outline"
                >
                  <ChevronLeft className="size-4" />
                  {t('common.previous')}
                </Button>
                <Button
                  disabled={page >= students.data.totalPages}
                  onClick={() => setPage((value) => value + 1)}
                  size="small"
                  variant="outline"
                >
                  {t('common.next')}
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </Card>
      <StudentDialog
        branches={branches.data ?? []}
        error={error}
        onClose={() => setDialogOpen(false)}
        onSubmit={save}
        open={dialogOpen}
        student={null}
      />
      <StudentBulkDialog
        action={bulkAction}
        groups={groups.data ?? []}
        onClose={() => setBulkAction(undefined)}
        onSuccess={(result) => void handleBulkSuccess(result)}
        open={Boolean(bulkAction)}
        studentIds={[...selectedIds]}
      />
    </main>
  );
}
