import {
  ARCHIVE_ENTITY_TYPES,
  formatDate,
  type ArchiveEntityType,
  type ArchiveItem,
} from '@arava/shared';
import { Button, Card, EmptyState, Input, LoadingState, PageHeader, Select } from '@arava/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArchiveRestore, ExternalLink, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { getDesktopApi } from '../../lib/desktop-api';
import { getErrorMessage } from '../../lib/errors';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';

const typeLabels: Record<ArchiveEntityType, string> = {
  BRANCH: 'Филиалы',
  CARD: 'Карты',
  EXPENSE_CATEGORY: 'Категории расходов',
  GROUP: 'Группы',
  PUBLICATION: 'Публикации',
  ROOM: 'Залы',
  STUDENT: 'Ученики',
  TARIFF: 'Тарифы',
  TRAINER: 'Тренеры',
};

function entityRoute(item: ArchiveItem): string | undefined {
  if (item.type === 'STUDENT') return `/students/${item.entityId}`;
  if (item.type === 'TRAINER') return `/trainers/${item.entityId}`;
  if (item.type === 'GROUP') return `/groups/${item.entityId}`;
  return undefined;
}

export function ArchivePage() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const role = useAuthStore((state) => state.user?.role);
  const [search, setSearch] = useState('');
  const [type, setType] = useState<ArchiveEntityType | ''>('');
  const [error, setError] = useState<string>();
  const query = useQuery({
    queryFn: () =>
      getDesktopApi().archive.list(getSessionToken(), {
        search: search.trim() || undefined,
        type: type || undefined,
      }),
    queryKey: ['archive', { search, type }],
  });
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['archive'] }),
      client.invalidateQueries({ queryKey: ['students'] }),
      client.invalidateQueries({ queryKey: ['groups'] }),
      client.invalidateQueries({ queryKey: ['branches'] }),
      client.invalidateQueries({ queryKey: ['rooms'] }),
      client.invalidateQueries({ queryKey: ['tariffs'] }),
      client.invalidateQueries({ queryKey: ['cards'] }),
      client.invalidateQueries({ queryKey: ['users'] }),
    ]);
  };
  const restore = useMutation({
    mutationFn: (item: ArchiveItem) =>
      getDesktopApi().archive.restore(getSessionToken(), item.type, item.entityId),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (item: ArchiveItem) =>
      getDesktopApi().archive.deletePermanently(getSessionToken(), item.type, item.entityId),
    onSuccess: refresh,
  });
  const run = async (action: () => Promise<unknown>, fallback: string) => {
    setError(undefined);
    try {
      await action();
    } catch (caught) {
      setError(getErrorMessage(caught, fallback));
    }
  };
  if (query.isLoading) return <LoadingState label="Загружаем архив..." />;
  return (
    <main className="mx-auto w-full max-w-[1300px] animate-fade-in p-9 pb-14">
      <PageHeader
        description="Восстановление архивных данных без потери связей и истории."
        title="Архив"
      />
      <Card className="mb-5 grid grid-cols-[minmax(260px,1fr)_260px] gap-3 p-4">
        <label className="relative">
          <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
          <Input
            className="pl-9"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Поиск по имени, названию или филиалу"
            value={search}
          />
        </label>
        <Select
          onChange={(event) => setType(event.target.value as ArchiveEntityType | '')}
          value={type}
        >
          <option value="">Все типы</option>
          {ARCHIVE_ENTITY_TYPES.map((value) => (
            <option key={value} value={value}>
              {typeLabels[value]} ({query.data?.counts[value] ?? 0})
            </option>
          ))}
        </Select>
      </Card>
      {error ? (
        <p className="mb-4 rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {!query.data?.items.length ? (
        <EmptyState
          description="Здесь появятся сущности, которые были архивированы в рабочих разделах CRM."
          icon={ArchiveRestore}
          title="Архив пуст"
        />
      ) : (
        <div className="space-y-3" data-testid="global-archive-list">
          {query.data.items.map((item) => {
            const route = entityRoute(item);
            return (
              <Card
                className="grid grid-cols-[minmax(0,1fr)_180px_auto] items-center gap-5 p-5"
                key={`${item.type}:${item.entityId}`}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {typeLabels[item.type]}
                    </span>
                    <h2 className="truncate font-semibold">{item.name}</h2>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {[item.branchName, item.context].filter(Boolean).join(' · ') ||
                      'Общий контекст'}
                  </p>
                  {item.archivedByName ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Архивировал: {item.archivedByName}
                    </p>
                  ) : null}
                </div>
                <div className="text-sm">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    В архиве с
                  </p>
                  <p className="mt-1 font-medium">
                    {formatDate(item.archivedAt, { dateStyle: 'medium', timeStyle: 'short' })}
                  </p>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  {route ? (
                    <Button onClick={() => navigate(route)} size="small" variant="ghost">
                      <ExternalLink className="size-4" />
                      Открыть
                    </Button>
                  ) : null}
                  <Button
                    disabled={restore.isPending || remove.isPending}
                    onClick={() =>
                      void run(() => restore.mutateAsync(item), 'Не удалось восстановить объект.')
                    }
                    size="small"
                    variant="outline"
                  >
                    <ArchiveRestore className="size-4" />
                    Восстановить
                  </Button>
                  {role === 'OWNER' ? (
                    <Button
                      disabled={restore.isPending || remove.isPending}
                      onClick={() => {
                        if (
                          !window.confirm(
                            `Удалить «${item.name}» навсегда? Отменить это действие нельзя.`,
                          )
                        )
                          return;
                        void run(
                          () => remove.mutateAsync(item),
                          'Удаление невозможно: проверьте связанные данные.',
                        );
                      }}
                      size="small"
                      variant="ghost"
                    >
                      <Trash2 className="size-4" />
                      Удалить навсегда
                    </Button>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}
