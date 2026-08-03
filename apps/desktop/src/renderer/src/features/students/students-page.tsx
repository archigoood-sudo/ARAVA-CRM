import {
  STUDENT_STATUSES,
  type StudentInput,
  type StudentListQuery,
  type StudentStatus,
} from '@arava/shared';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
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
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';
import { StudentDialog } from './student-dialog';

const statusLabels: Record<StudentStatus, string> = {
  ACTIVE: 'Active',
  ARCHIVED: 'Archived',
  FROZEN: 'Frozen',
  LEFT: 'Left',
  TRIAL: 'Trial',
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
  const canManage =
    user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'BRANCH_MANAGER';
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['students'] }),
  });
  const archive = useMutation({
    mutationFn: (id: string) => getDesktopApi().students.archive(getSessionToken(), id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['students'] }),
  });
  const save = async (input: StudentInput) => {
    setError(undefined);
    try {
      await create.mutateAsync(input);
      setDialogOpen(false);
    } catch (caught) {
      setError(getErrorMessage(caught, 'Student could not be created.'));
    }
  };
  const updateFilter = (callback: () => void) => {
    callback();
    setPage(1);
  };

  return (
    <main className="mx-auto w-full max-w-[1500px] p-9 pb-14">
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h2 className="text-4xl font-semibold tracking-[-0.045em]">
            Every student, clearly known.
          </h2>
          <p className="mt-2.5 text-base text-muted-foreground">
            Search, filter, and manage the studio community across branches.
          </p>
        </div>
        {canManage ? (
          <Button
            disabled={(branches.data?.length ?? 0) === 0}
            onClick={() => {
              setError(undefined);
              setDialogOpen(true);
            }}
          >
            <Plus className="size-4" />
            Add student
          </Button>
        ) : null}
      </div>
      <Card className="overflow-hidden">
        <div className="grid grid-cols-[minmax(260px,1fr)_220px_180px_180px_44px] gap-3 border-b border-border p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-3.5 size-4 text-muted-foreground" />
            <Input
              aria-label="Search students"
              className="pl-10"
              onChange={(event) => updateFilter(() => setSearch(event.target.value))}
              placeholder="Search name or phone"
              value={search}
            />
          </div>
          <Select
            aria-label="Filter by branch"
            onChange={(event) => updateFilter(() => setBranchId(event.target.value))}
            value={branchId}
          >
            <option value="">All branches</option>
            {branches.data?.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Filter by status"
            onChange={(event) =>
              updateFilter(() => setStatus(event.target.value as StudentStatus | ''))
            }
            value={status}
          >
            <option value="">Current statuses</option>
            {STUDENT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {statusLabels[value]}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Sort students"
            onChange={(event) => {
              setSortBy(event.target.value as StudentListQuery['sortBy']);
              setPage(1);
            }}
            value={sortBy}
          >
            <option value="name">Name</option>
            <option value="createdAt">Date added</option>
            <option value="birthDate">Birth date</option>
            <option value="status">Status</option>
          </Select>
          <Button
            aria-label="Reverse sort direction"
            onClick={() => setSortDirection((value) => (value === 'asc' ? 'desc' : 'asc'))}
            size="icon"
            variant="outline"
          >
            <ArrowDownUp className="size-4" />
          </Button>
        </div>
        {students.isLoading ? <LoadingState label="Loading students…" /> : null}
        {students.isError ? (
          <ErrorState
            message="Students could not be loaded."
            onRetry={() => void students.refetch()}
          />
        ) : null}
        {students.data?.items.length === 0 ? (
          <EmptyState
            action={
              canManage && !search && !status ? (
                <Button onClick={() => setDialogOpen(true)}>Add first student</Button>
              ) : undefined
            }
            description={
              search || status
                ? 'Try adjusting the search or filters.'
                : 'Add your first student to begin building the studio directory.'
            }
            icon={UsersRound}
            title={search || status ? 'No matching students' : 'No students yet'}
          />
        ) : null}
        {students.data && students.data.items.length > 0 ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Added</TableHead>
                  {canManage ? <TableHead className="text-right">Action</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {students.data.items.map((student) => (
                  <TableRow key={student.id}>
                    <TableCell>
                      <Link
                        className="font-semibold transition hover:text-accent-foreground dark:hover:text-accent"
                        to={`/students/${student.id}`}
                      >
                        {student.lastName} {student.firstName} {student.middleName ?? ''}
                      </Link>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {student.email ?? 'No email'}
                      </p>
                    </TableCell>
                    <TableCell>{student.branchName}</TableCell>
                    <TableCell className="text-muted-foreground">{student.phone ?? '—'}</TableCell>
                    <TableCell>
                      <Badge className={statusStyles[student.status]}>
                        {statusLabels[student.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Intl.DateTimeFormat('en', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      }).format(new Date(student.createdAt))}
                    </TableCell>
                    {canManage ? (
                      <TableCell className="text-right">
                        <Button
                          aria-label={`Archive ${student.firstName} ${student.lastName}`}
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
                {students.data.total} students · Page {students.data.page} of{' '}
                {students.data.totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  disabled={page <= 1}
                  onClick={() => setPage((value) => value - 1)}
                  size="small"
                  variant="outline"
                >
                  <ChevronLeft className="size-4" />
                  Previous
                </Button>
                <Button
                  disabled={page >= students.data.totalPages}
                  onClick={() => setPage((value) => value + 1)}
                  size="small"
                  variant="outline"
                >
                  Next
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
