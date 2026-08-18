import {
  PUBLICATION_AUDIENCES,
  PUBLICATION_TYPES,
  publicationInputSchema,
  type PublicationInput,
  type PublicationOptions,
  type PublicationSummary,
} from '@arava/shared';
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  Input,
  Label,
  LoadingState,
  PageHeader,
  Select,
  Textarea,
} from '@arava/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ImagePlus, Newspaper, Pencil, Plus, RefreshCw, Send } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { getDesktopApi } from '../../lib/desktop-api';
import { getErrorMessage } from '../../lib/errors';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';

const typeLabels = {
  ANNOUNCEMENT: 'Объявление',
  EVENT: 'Афиша',
  INFO: 'Информация',
  NEWS: 'Новость',
} as const;
const audienceLabels = {
  ALL_CLIENTS: 'Все клиенты',
  BRANCHES: 'Выбранные филиалы',
  GROUPS: 'Выбранные группы',
  TRAINERS: 'Тренеры',
} as const;
const statusLabels = { ARCHIVED: 'Архив', DRAFT: 'Черновик', PUBLISHED: 'Опубликовано' } as const;
const syncLabels = {
  ERROR: 'Ошибка синхронизации',
  LOCAL: 'Локально',
  PENDING: 'Ожидает отправки',
  SYNCED: 'Синхронизировано',
} as const;

export function PublicationsPage() {
  const user = useAuthStore((state) => state.user);
  const accessKey = `${user?.id ?? ''}:${user?.role ?? ''}:${[...(user?.branchIds ?? [])].sort().join(',')}`;
  const client = useQueryClient();
  const [editing, setEditing] = useState<PublicationSummary | null>();
  const [filter, setFilter] = useState('ALL');
  const publications = useQuery({
    queryFn: () => getDesktopApi().publications.list(getSessionToken()),
    queryKey: ['publications', accessKey],
    refetchInterval: 5_000,
  });
  const options = useQuery({
    queryFn: () => getDesktopApi().publications.options(getSessionToken()),
    queryKey: ['publication-options', accessKey],
  });
  const refresh = () => client.invalidateQueries({ queryKey: ['publications'] });
  const action = useMutation({
    mutationFn: ({ id, kind }: { id: string; kind: 'archive' | 'publish' | 'retry' }) =>
      getDesktopApi().publications[kind](getSessionToken(), id),
    onSuccess: refresh,
  });
  const visible = useMemo(
    () => publications.data?.filter((item) => filter === 'ALL' || item.status === filter) ?? [],
    [filter, publications.data],
  );

  return (
    <main className="mx-auto w-full max-w-[1460px] animate-fade-in p-9 pb-14">
      <PageHeader
        title="Публикации"
        description="Новости, объявления и афиша для личного кабинета ARAVA."
        action={
          <Button onClick={() => setEditing(null)}>
            <Plus className="size-4" />
            Создать публикацию
          </Button>
        }
      />
      <Card className="mb-5 flex gap-2 p-3">
        {[
          ['ALL', 'Все'],
          ['DRAFT', 'Черновики'],
          ['PUBLISHED', 'Опубликованные'],
          ['ARCHIVED', 'Архив'],
        ].map(([value, label]) => (
          <Button
            key={value}
            onClick={() => setFilter(value ?? 'ALL')}
            variant={filter === value ? 'primary' : 'ghost'}
          >
            {label}
          </Button>
        ))}
      </Card>
      {publications.isLoading ? <LoadingState label="Загружаем публикации…" /> : null}
      {publications.isError ? (
        <ErrorState
          title="Не удалось загрузить публикации"
          message="Повторите попытку."
          retryLabel="Повторить"
          onRetry={() => void publications.refetch()}
        />
      ) : null}
      {!publications.isLoading && visible.length === 0 ? (
        <EmptyState
          icon={Newspaper}
          title="Публикаций пока нет"
          description="Создайте черновик и опубликуйте его, когда материал будет готов."
          action={<Button onClick={() => setEditing(null)}>Создать первую публикацию</Button>}
        />
      ) : null}
      <div className="grid gap-4 xl:grid-cols-2">
        {visible.map((item) => (
          <Card className="p-6" key={item.id}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap gap-2">
                  <Badge>{typeLabels[item.type]}</Badge>
                  <Badge className="bg-muted text-muted-foreground">
                    {statusLabels[item.status]}
                  </Badge>
                  <Badge
                    className={
                      item.syncState === 'ERROR'
                        ? 'bg-red-50 text-red-700'
                        : item.syncState === 'SYNCED'
                          ? 'bg-green-50 text-green-700'
                          : 'bg-amber-50 text-amber-700'
                    }
                  >
                    {syncLabels[item.syncState]}
                  </Badge>
                </div>
                <h2 className="mt-4 text-xl font-semibold">{item.title}</h2>
                <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm leading-6 text-muted-foreground">
                  {item.body}
                </p>
              </div>
              {item.mediaFileName ? (
                <div className="rounded-xl bg-lime-100 p-3 text-lime-900">
                  <ImagePlus className="size-5" />
                </div>
              ) : null}
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-2 border-t pt-4">
              <span className="mr-auto text-xs text-muted-foreground">
                {audienceLabels[item.audienceMode]} · {item.authorName}
              </span>
              {item.syncState === 'ERROR' ? (
                <Button
                  size="small"
                  variant="outline"
                  onClick={() => action.mutate({ id: item.id, kind: 'retry' })}
                >
                  <RefreshCw className="size-4" />
                  Повторить
                </Button>
              ) : null}
              {item.status !== 'ARCHIVED' ? (
                <Button size="small" variant="outline" onClick={() => setEditing(item)}>
                  <Pencil className="size-4" />
                  Изменить
                </Button>
              ) : null}
              {item.status === 'DRAFT' ? (
                <Button
                  size="small"
                  onClick={() => action.mutate({ id: item.id, kind: 'publish' })}
                >
                  <Send className="size-4" />
                  Опубликовать
                </Button>
              ) : null}
              {item.status === 'PUBLISHED' ? (
                <Button
                  size="small"
                  variant="outline"
                  onClick={() => action.mutate({ id: item.id, kind: 'archive' })}
                >
                  <Archive className="size-4" />В архив
                </Button>
              ) : null}
            </div>
          </Card>
        ))}
      </div>
      {editing !== undefined ? (
        <PublicationDialog
          publication={editing}
          options={options.data ?? { branches: [], groups: [] }}
          onClose={() => setEditing(undefined)}
          onSaved={async () => {
            await refresh();
            setEditing(undefined);
          }}
        />
      ) : null}
    </main>
  );
}

function PublicationDialog({
  publication,
  options,
  onClose,
  onSaved,
}: {
  publication: PublicationSummary | null;
  options: PublicationOptions;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [value, setValue] = useState<PublicationInput>(() => inputFrom(publication));
  const [error, setError] = useState<string>();
  const [imageName, setImageName] = useState(publication?.mediaFileName);
  useEffect(() => setValue(inputFrom(publication)), [publication]);
  const save = useMutation({
    mutationFn: (input: PublicationInput) =>
      publication
        ? getDesktopApi().publications.update(getSessionToken(), publication.id, input)
        : getDesktopApi().publications.create(getSessionToken(), input),
  });
  const targets =
    value.audienceMode === 'BRANCHES'
      ? options.branches
      : value.audienceMode === 'GROUPS'
        ? options.groups
        : [];
  const submit = async () => {
    const parsed = publicationInputSchema.safeParse(value);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }
    try {
      await save.mutateAsync(parsed.data);
      await onSaved();
    } catch (caught) {
      setError(getErrorMessage(caught, 'Не удалось сохранить публикацию.'));
    }
  };
  return (
    <Dialog
      open
      title={publication ? 'Изменить публикацию' : 'Новая публикация'}
      description={
        publication
          ? 'Изменения синхронизируются с той же публикацией.'
          : 'Материал сохранится локально как черновик.'
      }
      closeLabel="Закрыть"
      onClose={onClose}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <label className="space-y-2">
            <Label>Тип</Label>
            <Select
              value={value.type}
              onChange={(e) =>
                setValue({ ...value, type: e.target.value as PublicationInput['type'] })
              }
            >
              {PUBLICATION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {typeLabels[type]}
                </option>
              ))}
            </Select>
          </label>
          <label className="space-y-2">
            <Label>Аудитория</Label>
            <Select
              value={value.audienceMode}
              onChange={(e) =>
                setValue({
                  ...value,
                  audienceMode: e.target.value as PublicationInput['audienceMode'],
                  targetIds: [],
                })
              }
            >
              {PUBLICATION_AUDIENCES.map((audience) => (
                <option key={audience} value={audience}>
                  {audienceLabels[audience]}
                </option>
              ))}
            </Select>
          </label>
        </div>
        <label className="block space-y-2">
          <Label>Заголовок</Label>
          <Input
            value={value.title}
            onChange={(e) => setValue({ ...value, title: e.target.value })}
          />
        </label>
        <label className="block space-y-2">
          <Label>Текст</Label>
          <Textarea
            className="min-h-36"
            value={value.body}
            onChange={(e) => setValue({ ...value, body: e.target.value })}
          />
        </label>
        {targets.length ? (
          <div className="space-y-2">
            <Label>Получатели</Label>
            <div className="max-h-36 space-y-1 overflow-auto rounded-xl border p-3">
              {targets.map((target) => (
                <label
                  className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-muted"
                  key={target.id}
                >
                  <input
                    checked={value.targetIds.includes(target.id)}
                    type="checkbox"
                    onChange={() =>
                      setValue({
                        ...value,
                        targetIds: value.targetIds.includes(target.id)
                          ? value.targetIds.filter((id) => id !== target.id)
                          : [...value.targetIds, target.id],
                      })
                    }
                  />
                  {'branchId' in target
                    ? `${target.name} · ${options.branches.find((branch) => branch.id === target.branchId)?.name ?? ''}`
                    : target.name}
                </label>
              ))}
            </div>
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-4">
          <label className="space-y-2">
            <Label>Показать с</Label>
            <Input
              type="datetime-local"
              value={localDate(value.publishAt)}
              onChange={(e) => setValue({ ...value, publishAt: isoDate(e.target.value) })}
            />
          </label>
          <label className="space-y-2">
            <Label>Скрыть после</Label>
            <Input
              type="datetime-local"
              value={localDate(value.expiresAt)}
              onChange={(e) => setValue({ ...value, expiresAt: isoDate(e.target.value) })}
            />
          </label>
        </div>
        {value.type === 'EVENT' ? (
          <div className="grid grid-cols-2 gap-4">
            <label className="space-y-2">
              <Label>Дата события</Label>
              <Input
                type="datetime-local"
                value={localDate(value.eventStartsAt)}
                onChange={(e) => setValue({ ...value, eventStartsAt: isoDate(e.target.value) })}
              />
            </label>
            <label className="space-y-2">
              <Label>Место</Label>
              <Input
                value={value.eventLocation ?? ''}
                onChange={(e) => setValue({ ...value, eventLocation: e.target.value || undefined })}
              />
            </label>
          </div>
        ) : null}
        <Button
          variant="outline"
          onClick={async () => {
            const image = await getDesktopApi().publications.selectImage(getSessionToken());
            if (image) {
              setImageName(image.fileName);
              setValue({ ...value, mediaId: image.mediaId });
            }
          }}
        >
          <ImagePlus className="size-4" />
          {imageName ?? 'Выбрать изображение'}
        </Button>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={save.isPending} onClick={() => void submit()}>
            {save.isPending
              ? 'Сохраняем…'
              : publication
                ? 'Сохранить изменения'
                : 'Сохранить черновик'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function inputFrom(item: PublicationSummary | null): PublicationInput {
  return item
    ? {
        audienceMode: item.audienceMode,
        body: item.body,
        eventLocation: item.eventLocation,
        eventStartsAt: item.eventStartsAt,
        expiresAt: item.expiresAt,
        publishAt: item.publishAt,
        targetIds: item.targetIds,
        title: item.title,
        type: item.type,
      }
    : { audienceMode: 'ALL_CLIENTS', body: '', targetIds: [], title: '', type: 'NEWS' };
}
function localDate(value?: string): string {
  return value ? new Date(value).toISOString().slice(0, 16) : '';
}
function isoDate(value: string): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}
