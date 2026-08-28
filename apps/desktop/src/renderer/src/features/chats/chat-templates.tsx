import {
  renderCommunicationTemplate,
  type CommunicationTemplate,
  type CommunicationTemplateInput,
} from '@arava/shared';
import { Button, Dialog, Input, Label, Textarea } from '@arava/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, FileText, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { getDesktopApi } from '../../lib/desktop-api';
import { getErrorMessage } from '../../lib/errors';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';

export function ChatTemplates({
  accessKey,
  conversationId,
  onInsert,
  requestedTemplateId,
  studentId,
}: {
  accessKey: string;
  conversationId: string;
  onInsert: (text: string) => void;
  requestedTemplateId?: string | undefined;
  studentId?: string | undefined;
}) {
  const role = useAuthStore((state) => state.user?.role);
  const [menuOpen, setMenuOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [error, setError] = useState<string>();
  const insertedRequest = useRef<string>();
  const templates = useQuery({
    queryFn: () => getDesktopApi().chats.templateList(getSessionToken()),
    queryKey: queryKeys.chatTemplates(accessKey),
  });
  const context = useQuery({
    queryFn: () =>
      getDesktopApi().chats.templateContext(getSessionToken(), conversationId, studentId),
    queryKey: queryKeys.chatTemplateContext(accessKey, conversationId, studentId),
  });
  const insert = (template: CommunicationTemplate) => {
    if (!context.data) return;
    const rendered = renderCommunicationTemplate(template, context.data);
    if (!rendered.text) {
      setError(rendered.error ?? 'Не удалось заполнить шаблон.');
      return;
    }
    onInsert(rendered.text);
    setError(undefined);
    setMenuOpen(false);
  };

  useEffect(() => {
    if (!requestedTemplateId || insertedRequest.current === requestedTemplateId) return;
    const template = templates.data?.find(({ id }) => id === requestedTemplateId);
    if (!template || !context.data) return;
    insertedRequest.current = requestedTemplateId;
    insert(template);
    // Insert an explicitly requested suggestion once after both queries are ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context.data, requestedTemplateId, templates.data]);

  return (
    <div className="relative shrink-0">
      <Button
        onClick={() => setMenuOpen((open) => !open)}
        size="small"
        type="button"
        variant="outline"
      >
        <FileText className="size-4" /> Шаблоны
      </Button>
      {menuOpen ? (
        <div className="absolute bottom-11 left-0 z-20 w-80 max-w-[calc(100vw-3rem)] rounded-2xl border border-border bg-surface p-2 shadow-xl">
          <div className="max-h-72 overflow-y-auto">
            {templates.isLoading || context.isLoading ? (
              <p className="p-3 text-sm text-muted-foreground">Загружаем шаблоны…</p>
            ) : null}
            {templates.data?.map((template) => {
              const rendered = context.data
                ? renderCommunicationTemplate(template, context.data)
                : undefined;
              return (
                <button
                  className="block w-full rounded-xl px-3 py-2 text-left transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!rendered?.text}
                  key={template.id}
                  onClick={() => insert(template)}
                  title={rendered?.error}
                  type="button"
                >
                  <span className="block text-sm font-semibold">{template.name}</span>
                  <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                    {rendered?.text ?? rendered?.error}
                  </span>
                </button>
              );
            })}
          </div>
          {role === 'OWNER' ? (
            <button
              className="mt-1 flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-xs font-semibold hover:text-primary"
              onClick={() => {
                setMenuOpen(false);
                setManageOpen(true);
              }}
              type="button"
            >
              <Pencil className="size-3.5" /> Управлять шаблонами
            </button>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p className="absolute bottom-11 left-0 z-30 w-80 rounded-xl bg-red-50 p-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}
      {role === 'OWNER' ? (
        <TemplateManager
          accessKey={accessKey}
          onClose={() => setManageOpen(false)}
          open={manageOpen}
        />
      ) : null}
    </div>
  );
}

function TemplateManager({
  accessKey,
  onClose,
  open,
}: {
  accessKey: string;
  onClose: () => void;
  open: boolean;
}) {
  const client = useQueryClient();
  const [editingId, setEditingId] = useState<string>();
  const [input, setInput] = useState<CommunicationTemplateInput>({ name: '', text: '' });
  const [error, setError] = useState<string>();
  const templates = useQuery({
    enabled: open,
    queryFn: () => getDesktopApi().chats.templateList(getSessionToken(), true),
    queryKey: queryKeys.chatTemplates(accessKey, true),
  });
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['chats', accessKey, 'templates'] });
  };
  const save = useMutation({
    mutationFn: () =>
      editingId
        ? getDesktopApi().chats.templateUpdate(getSessionToken(), editingId, input)
        : getDesktopApi().chats.templateCreate(getSessionToken(), input),
    onError: (caught) => setError(getErrorMessage(caught, 'Не удалось сохранить шаблон.')),
    onSuccess: async () => {
      setEditingId(undefined);
      setInput({ name: '', text: '' });
      setError(undefined);
      await refresh();
    },
  });
  const archive = useMutation({
    mutationFn: (id: string) => getDesktopApi().chats.templateArchive(getSessionToken(), id),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => getDesktopApi().chats.templateDelete(getSessionToken(), id),
    onSuccess: refresh,
  });
  const custom = templates.data?.filter(({ source }) => source === 'CUSTOM') ?? [];
  return (
    <Dialog
      closeLabel="Закрыть"
      description="Шаблон только заполняет поле сообщения. Отправка всегда остаётся ручной."
      onClose={onClose}
      open={open}
      title="Шаблоны сообщений"
    >
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <div>
          <Label htmlFor="template-name">Название</Label>
          <Input
            id="template-name"
            maxLength={80}
            onChange={(event) => setInput((current) => ({ ...current, name: event.target.value }))}
            value={input.name}
          />
        </div>
        <div>
          <Label htmlFor="template-text">Текст</Label>
          <Textarea
            className="min-h-28"
            id="template-text"
            maxLength={1200}
            onChange={(event) => setInput((current) => ({ ...current, text: event.target.value }))}
            placeholder="Можно использовать {{STUDENT_NAME}}, {{GROUP_NAME}}, {{LESSON_DATE}}, {{LESSON_TIME}}"
            value={input.text}
          />
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex gap-2">
          <Button disabled={save.isPending} size="small" type="submit">
            {editingId ? (
              'Сохранить'
            ) : (
              <>
                <Plus className="size-4" /> Создать
              </>
            )}
          </Button>
          {editingId ? (
            <Button
              onClick={() => {
                setEditingId(undefined);
                setInput({ name: '', text: '' });
              }}
              size="small"
              type="button"
              variant="ghost"
            >
              Отмена
            </Button>
          ) : null}
        </div>
      </form>
      <div className="mt-5 max-h-64 space-y-2 overflow-y-auto border-t border-border pt-4">
        {custom.length === 0 ? (
          <p className="text-sm text-muted-foreground">Пользовательских шаблонов пока нет.</p>
        ) : null}
        {custom.map((template) => (
          <div
            className="flex items-start gap-2 rounded-xl border border-border p-3"
            key={template.id}
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{template.name}</p>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{template.text}</p>
              {template.archivedAt ? <p className="mt-1 text-xs text-amber-700">В архиве</p> : null}
            </div>
            {!template.archivedAt ? (
              <>
                <Button
                  aria-label={`Изменить ${template.name}`}
                  onClick={() => {
                    setEditingId(template.id);
                    setInput({ name: template.name, text: template.text });
                  }}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  aria-label={`Архивировать ${template.name}`}
                  onClick={() => archive.mutate(template.id)}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <Archive className="size-4" />
                </Button>
              </>
            ) : null}
            <Button
              aria-label={`Удалить ${template.name}`}
              onClick={() => remove.mutate(template.id)}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
