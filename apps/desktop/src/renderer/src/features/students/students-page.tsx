import {
  STUDENT_STATUSES,
  formatDate,
  t,
  type StudentInput,
  type StudentListQuery,
  type StudentStatus,
} from '@arava/shared';
import {
  Badge,
  Avatar,
  Button,
  Card,
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
  ArrowDownUp,
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  UsersRound,
} from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Link } from 'react-router-dom';

import { getDesktopApi } from '../../lib/desktop-api';
import { getErrorMessage } from '../../lib/errors';
import { invalidateStudentIdentityCaches } from '../../lib/operational-cache';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';
import { StudentDialog } from './student-dialog';

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

  return (
    <main className="mx-auto w-full max-w-[1500px] p-9 pb-14">
      <PageHeader
        action={
          canManage ? (
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
          ) : undefined
        }
        description={t('student.pageDescription')}
        title={t('student.pageTitle')}
      />
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
                    {canManage ? (
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
    </main>
  );
}
