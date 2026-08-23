import {
  GROUP_STATUSES,
  t,
  type GroupInput,
  type GroupListQuery,
  type GroupStatus,
  type GroupSummary,
} from '@arava/shared';
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
  Select,
  StatusBadge,
  type StatusTone,
} from '@arava/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArrowRight, MapPin, Pencil, Plus, Search, UsersRound } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { getDesktopApi } from '../../lib/desktop-api';
import { getErrorMessage } from '../../lib/errors';
import { invalidateGlobalSearchCache } from '../../lib/operational-cache';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';
import { GroupDialog } from './group-dialog';

const tones: Record<GroupStatus, StatusTone> = {
  ACTIVE: 'success',
  ARCHIVED: 'muted',
  PAUSED: 'warning',
  RECRUITING: 'accent',
};

export function GroupsPage() {
  const user = useAuthStore((state) => state.user);
  const canManage = user?.role !== 'COACH';
  const navigate = useNavigate();
  const client = useQueryClient();
  const [query, setQuery] = useState<GroupListQuery>({});
  const [dialog, setDialog] = useState(false);
  const [editing, setEditing] = useState<GroupSummary | null>(null);
  const [error, setError] = useState<string>();
  const groups = useQuery({
    queryFn: () => getDesktopApi().groups.list(getSessionToken(), query),
    queryKey: queryKeys.groups(query),
  });
  const branches = useQuery({
    queryFn: () => getDesktopApi().branches.list(getSessionToken()),
    queryKey: queryKeys.branches(),
  });
  const staff = useQuery({
    queryFn: () => getDesktopApi().users.staffOptions(getSessionToken()),
    queryKey: queryKeys.staffOptions,
  });
  const save = useMutation({
    mutationFn: (input: GroupInput) =>
      editing
        ? getDesktopApi().groups.update(getSessionToken(), editing.id, input)
        : getDesktopApi().groups.create(getSessionToken(), input),
  });
  const archive = useMutation({
    mutationFn: (id: string) => getDesktopApi().groups.archive(getSessionToken(), id),
  });
  const directions = useMemo(
    () => [...new Set((groups.data ?? []).map(({ direction }) => direction))].sort(),
    [groups.data],
  );
  const submit = async (input: GroupInput) => {
    setError(undefined);
    try {
      await save.mutateAsync(input);
      await Promise.all([
        client.invalidateQueries({ queryKey: ['groups'] }),
        invalidateGlobalSearchCache(client),
      ]);
      setDialog(false);
    } catch (caught) {
      setError(getErrorMessage(caught, t('group.errorSave')));
    }
  };
  const archiveGroup = async (id: string) => {
    await archive.mutateAsync(id);
    await Promise.all([
      client.invalidateQueries({ queryKey: ['groups'] }),
      invalidateGlobalSearchCache(client),
    ]);
  };
  return (
    <main className="mx-auto w-full max-w-[1540px] animate-fade-in p-9 pb-14">
      <PageHeader
        action={
          canManage ? (
            <Button
              onClick={() => {
                setEditing(null);
                setError(undefined);
                setDialog(true);
              }}
            >
              <Plus className="size-4" />
              {t('group.action.add')}
            </Button>
          ) : undefined
        }
        description={t('group.pageDescription')}
        eyebrow={t('page.groups.eyebrow')}
        title={t('group.pageTitle')}
      />
      <Card className="mb-5 grid grid-cols-[minmax(260px,1fr)_repeat(4,minmax(150px,0.5fr))] gap-3 p-4">
        <label className="relative">
          <Search className="absolute left-3 top-3.5 size-4 text-muted-foreground" />
          <Input
            className="pl-9"
            onChange={(event) =>
              setQuery((value) => ({ ...value, search: event.target.value || undefined }))
            }
            placeholder={t('group.searchPlaceholder')}
          />
        </label>
        <Select
          aria-label={t('group.filter.branch')}
          onChange={(event) =>
            setQuery((value) => ({ ...value, branchId: event.target.value || undefined }))
          }
        >
          <option value="">{t('student.filter.allBranches')}</option>
          {branches.data?.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('group.filter.coach')}
          onChange={(event) =>
            setQuery((value) => ({ ...value, coachId: event.target.value || undefined }))
          }
        >
          <option value="">{t('group.allCoaches')}</option>
          {staff.data?.map((coach) => (
            <option key={coach.id} value={coach.id}>
              {coach.fullName}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('group.filter.direction')}
          onChange={(event) =>
            setQuery((value) => ({ ...value, direction: event.target.value || undefined }))
          }
        >
          <option value="">{t('group.allDirections')}</option>
          {directions.map((direction) => (
            <option key={direction}>{direction}</option>
          ))}
        </Select>
        <Select
          aria-label={t('group.filter.status')}
          onChange={(event) =>
            setQuery((value) => ({
              ...value,
              status: (event.target.value || undefined) as GroupStatus | undefined,
            }))
          }
        >
          <option value="">{t('group.allStatuses')}</option>
          {GROUP_STATUSES.map((status) => (
            <option key={status} value={status}>
              {t(`group.status.${status}`)}
            </option>
          ))}
        </Select>
      </Card>
      {groups.isLoading ? <LoadingState label={t('group.loading')} /> : null}
      {groups.isError ? (
        <ErrorState
          message={t('group.errorLoad')}
          onRetry={() => void groups.refetch()}
          retryLabel={t('common.retry')}
          title={t('common.errorTitle')}
        />
      ) : null}
      {groups.data?.length === 0 ? (
        <EmptyState
          action={
            canManage ? (
              <Button onClick={() => setDialog(true)}>{t('group.action.addFirst')}</Button>
            ) : undefined
          }
          description={t('group.emptyDescription')}
          icon={UsersRound}
          title={t('group.emptyTitle')}
        />
      ) : null}
      <section className="grid grid-cols-3 gap-4">
        {groups.data?.map((group) => (
          <article
            className="group overflow-hidden rounded-[22px] border border-border bg-surface shadow-card transition hover:-translate-y-0.5 hover:shadow-elevated"
            key={group.id}
          >
            <div className="h-1.5" style={{ backgroundColor: group.color ?? '#9CFF2E' }} />
            <div className="p-5">
              <div className="flex items-start gap-3">
                <Avatar name={group.name} />
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-lg font-semibold">{group.name}</h3>
                  <p className="mt-0.5 text-sm text-muted-foreground">{group.direction}</p>
                </div>
                <StatusBadge tone={tones[group.status]}>
                  {t(`group.status.${group.status}`)}
                </StatusBadge>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-xl bg-muted/60 p-3">
                  <p className="text-xs text-muted-foreground">
                    {t('group.students', { count: group.studentCount })}
                  </p>
                  <p className="mt-1 font-semibold">
                    {t('group.available', { count: group.availablePlaces })}
                  </p>
                </div>
                <div className="rounded-xl bg-muted/60 p-3">
                  <p className="text-xs text-muted-foreground">{t('group.attendance')}</p>
                  <p className="mt-1 font-semibold">{group.attendancePercentage}%</p>
                </div>
              </div>
              <div className="mt-4 space-y-2 text-xs text-muted-foreground">
                <p className="flex items-center gap-2">
                  <MapPin className="size-3.5 text-accent-foreground" />
                  {group.branchName}
                </p>
                <p className="truncate">{group.coachName ?? t('group.noCoach')}</p>
              </div>
              <div className="mt-5 flex items-center gap-1 border-t border-border pt-3">
                <Button
                  onClick={() => navigate(`/groups/${group.id}`)}
                  size="small"
                  variant="ghost"
                >
                  {t('common.actions')}
                  <ArrowRight className="size-4" />
                </Button>
                {canManage ? (
                  <>
                    <Button
                      aria-label={t('group.action.edit')}
                      className="ml-auto"
                      onClick={() => {
                        setEditing(group);
                        setDialog(true);
                      }}
                      size="icon"
                      variant="ghost"
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      aria-label={t('group.action.archive')}
                      disabled={group.status === 'ARCHIVED'}
                      onClick={() => void archiveGroup(group.id)}
                      size="icon"
                      variant="ghost"
                    >
                      <Archive className="size-4" />
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          </article>
        ))}
      </section>
      <GroupDialog
        branches={branches.data ?? []}
        error={error}
        group={editing}
        onClose={() => setDialog(false)}
        onSubmit={submit}
        open={dialog}
        staff={staff.data ?? []}
      />
    </main>
  );
}
