import type { ChatFilter, ChatImageAttachment, ChatMessage, ChatSummary } from '@arava/shared';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
} from '@arava/ui';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImageOff, MessageCircle, RefreshCw, Search, Send, UsersRound } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { getDesktopApi } from '../../lib/desktop-api';
import { getErrorMessage } from '../../lib/errors';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';
import { safeChatReturn } from '../students/student-communication-model';

const filters: { id: ChatFilter; label: string }[] = [
  { id: 'ALL', label: 'Все' },
  { id: 'PRIVATE_ADMIN', label: 'Личные' },
  { id: 'GROUP', label: 'Группы' },
  { id: 'UNREAD', label: 'Непрочитанные' },
];

export function ChatsPage() {
  const user = useAuthStore((state) => state.user);
  const accessKey = `${user?.id ?? ''}:${user?.role ?? ''}:${[...(user?.branchIds ?? [])].sort().join(',')}`;
  const client = useQueryClient();
  const [filter, setFilter] = useState<ChatFilter>('ALL');
  const [search, setSearch] = useState('');
  const [searchParameters] = useSearchParams();
  const [selectedId, setSelectedId] = useState(searchParameters.get('conversationId') ?? '');
  const returnTo = safeChatReturn(searchParameters.get('returnTo'));
  const query = useMemo(() => ({ filter, search: search.trim() || undefined }), [filter, search]);
  const chats = useQuery({
    queryFn: () => getDesktopApi().chats.list(getSessionToken(), query),
    queryKey: queryKeys.chats(accessKey, query),
    refetchInterval: 20_000,
  });
  const selected = chats.data?.conversations.find((item) => item.id === selectedId);

  useEffect(() => {
    const first = chats.data?.conversations[0];
    if (!selectedId && first) setSelectedId(first.id);
    if (
      selectedId &&
      chats.data &&
      !chats.data.conversations.some((item) => item.id === selectedId)
    ) {
      setSelectedId(first?.id ?? '');
    }
  }, [chats.data, selectedId]);
  useEffect(() => {
    const refresh = () => void client.invalidateQueries({ queryKey: ['chats', accessKey] });
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [accessKey, client]);
  useEffect(() => {
    if (chats.dataUpdatedAt)
      void client.invalidateQueries({ queryKey: ['student-communication', accessKey] });
  }, [accessKey, chats.dataUpdatedAt, client]);

  return (
    <main className="mx-auto flex h-full w-full max-w-[1600px] flex-col p-9 pb-8">
      <PageHeader
        description="Личные обращения клиентов и групповые разговоры из ARAVA-WEB."
        eyebrow="ARAVA ECOSYSTEM"
        title="Чаты"
      />
      {returnTo ? (
        <Link
          className="mt-3 inline-flex w-fit items-center text-sm font-semibold text-muted-foreground hover:text-foreground"
          to={returnTo}
        >
          ← Вернуться к ученику
        </Link>
      ) : null}
      <Card className="mt-6 grid min-h-0 flex-1 grid-cols-[360px_minmax(0,1fr)] overflow-hidden p-0">
        <aside className="flex min-h-0 flex-col border-r border-border bg-muted/20">
          <div className="space-y-3 border-b border-border p-4">
            <label className="relative block">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Поиск чатов"
                className="pl-9"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Клиент или группа"
                value={search}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              {filters.map((item) => (
                <button
                  className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${filter === item.id ? 'bg-sidebar text-white' : 'bg-surface text-muted-foreground hover:text-foreground'}`}
                  key={item.id}
                  onClick={() => setFilter(item.id)}
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {chats.isLoading ? <LoadingState label="Загружаем чаты…" /> : null}
            {chats.isError ? (
              <ErrorState
                message={getErrorMessage(chats.error, 'Не удалось связаться с ARAVA-WEB.')}
                onRetry={() => void chats.refetch()}
                retryLabel="Повторить"
                title="Чаты недоступны"
              />
            ) : null}
            {chats.data && chats.data.conversations.length === 0 ? (
              <EmptyState
                description="Новые разговоры появятся после сообщения клиента или синхронизации группы."
                icon={MessageCircle}
                title="Чатов пока нет"
              />
            ) : null}
            {chats.data?.conversations.map((conversation) => (
              <ConversationButton
                conversation={conversation}
                key={conversation.id}
                onClick={() => setSelectedId(conversation.id)}
                selected={conversation.id === selectedId}
              />
            ))}
          </div>
        </aside>
        {selected ? (
          <ConversationView accessKey={accessKey} conversation={selected} />
        ) : (
          <div className="flex items-center justify-center p-10">
            <EmptyState
              description="Выберите разговор слева, чтобы увидеть историю и ответить."
              icon={MessageCircle}
              title="Выберите чат"
            />
          </div>
        )}
      </Card>
    </main>
  );
}

function ConversationButton({
  conversation,
  onClick,
  selected,
}: {
  conversation: ChatSummary;
  onClick: () => void;
  selected: boolean;
}) {
  const activity = conversation.lastMessageAt ?? conversation.updatedAt;
  return (
    <button
      className={`mb-1 flex w-full gap-3 rounded-2xl p-3 text-left transition ${selected ? 'bg-white shadow-soft dark:bg-white/10' : 'hover:bg-white/70 dark:hover:bg-white/5'}`}
      onClick={onClick}
      type="button"
    >
      <Avatar name={conversation.title} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <b className="truncate text-sm">{conversation.title}</b>
          <time className="shrink-0 text-[10px] text-muted-foreground">
            {formatShort(activity)}
          </time>
        </span>
        <span className="mt-1 flex items-center gap-2">
          <small className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {(conversation.lastMessage ?? conversation.subtitle) || 'Нет сообщений'}
          </small>
          {conversation.unreadCount ? (
            <span className="min-w-5 rounded-full bg-accent px-1.5 py-0.5 text-center text-[10px] font-bold text-neutral-950">
              {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

function ConversationView({
  accessKey,
  conversation,
}: {
  accessKey: string;
  conversation: ChatSummary;
}) {
  const client = useQueryClient();
  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState<string>();
  const messages = useInfiniteQuery({
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      getDesktopApi().chats.messages(getSessionToken(), conversation.id, pageParam),
    queryKey: queryKeys.chatMessages(accessKey, conversation.id),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchInterval: 20_000,
  });
  const read = useMutation({
    mutationFn: () => getDesktopApi().chats.read(getSessionToken(), conversation.id),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['chats', accessKey] }),
        client.invalidateQueries({ queryKey: ['student-communication', accessKey] }),
      ]);
    },
  });
  useEffect(() => {
    read.mutate();
    // A conversation change is the only event that should mark the studio inbox read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id]);
  const send = useMutation({
    mutationFn: (text: string) =>
      getDesktopApi().chats.send(getSessionToken(), conversation.id, {
        clientMessageId: crypto.randomUUID(),
        text,
      }),
    onError: (error) => setSendError(getErrorMessage(error, 'Не удалось отправить сообщение.')),
    onSuccess: () => {
      setDraft('');
      setSendError(undefined);
      void client.invalidateQueries({
        queryKey: queryKeys.chatMessages(accessKey, conversation.id),
      });
      void client.invalidateQueries({ queryKey: ['chats', accessKey] });
      void client.invalidateQueries({ queryKey: ['student-communication', accessKey] });
    },
  });
  const allMessages = [...(messages.data?.pages ?? [])].reverse().flatMap((page) => page.messages);
  return (
    <section className="flex min-h-0 flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-accent/20 text-neutral-900">
            {conversation.type === 'GROUP' ? (
              <UsersRound className="size-5" />
            ) : (
              <MessageCircle className="size-5" />
            )}
          </span>
          <div>
            <h2 className="font-semibold">{conversation.title}</h2>
            <p className="text-xs text-muted-foreground">
              {conversation.type === 'GROUP' ? 'Групповой чат' : 'Личный чат с администрацией'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {conversation.crmGroupId ? (
            <Link
              className="inline-flex h-9 items-center rounded-xl border border-border bg-surface px-3 text-sm font-semibold hover:bg-muted"
              to={`/groups/${conversation.crmGroupId}`}
            >
              Открыть группу
            </Link>
          ) : null}
          {conversation.linkedStudents.map((student) => (
            <Link
              className="inline-flex h-9 items-center rounded-xl border border-border bg-surface px-3 text-sm font-semibold hover:bg-muted"
              key={student.studentId}
              to={`/students/${student.studentId}`}
            >
              {student.firstName}
            </Link>
          ))}
          <Button onClick={() => void messages.refetch()} size="icon" variant="ghost">
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto bg-muted/10 px-8 py-6">
        {messages.hasNextPage ? (
          <div className="mb-5 text-center">
            <Button onClick={() => void messages.fetchNextPage()} variant="outline">
              Загрузить более ранние сообщения
            </Button>
          </div>
        ) : null}
        {messages.isLoading ? <LoadingState label="Загружаем сообщения…" /> : null}
        {messages.isError ? (
          <ErrorState
            message={getErrorMessage(messages.error, 'История сообщений недоступна.')}
            onRetry={() => void messages.refetch()}
            retryLabel="Повторить"
            title="Не удалось открыть чат"
          />
        ) : null}
        {!messages.isLoading && !messages.isError && allMessages.length === 0 ? (
          <EmptyState
            description="Отправьте первое сообщение в этот разговор."
            icon={MessageCircle}
            title="Сообщений пока нет"
          />
        ) : null}
        <div className="space-y-4">
          {allMessages.map((message) => (
            <MessageBubble
              accessKey={accessKey}
              conversationId={conversation.id}
              key={message.id}
              message={message}
            />
          ))}
        </div>
      </div>
      <form
        className="border-t border-border bg-surface p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.trim()) send.mutate(draft.trim());
        }}
      >
        {sendError ? <p className="mb-2 text-sm text-red-600">{sendError}</p> : null}
        <div className="flex gap-3">
          <Input
            aria-label="Сообщение"
            maxLength={1200}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Написать сообщение…"
            value={draft}
          />
          <Button disabled={!draft.trim() || send.isPending} type="submit">
            <Send className="size-4" />
            Отправить
          </Button>
        </div>
      </form>
    </section>
  );
}

function MessageBubble({
  accessKey,
  conversationId,
  message,
}: {
  accessKey: string;
  conversationId: string;
  message: ChatMessage;
}) {
  const studio = message.senderType === 'admin' || message.senderType === 'trainer';
  return (
    <div className={`flex ${studio ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[72%] rounded-2xl px-4 py-3 ${studio ? 'bg-sidebar text-white' : 'border border-border bg-surface'}`}
      >
        <div className="mb-1 flex items-center gap-2 text-xs">
          <b>{message.senderName}</b>
          <Badge>{roleLabel(message.senderRole)}</Badge>
        </div>
        {message.attachments.length ? (
          <div className="mb-2 grid max-w-md gap-2">
            {message.attachments.map((attachment) => (
              <ChatImage
                accessKey={accessKey}
                attachment={attachment}
                conversationId={conversationId}
                key={attachment.id}
              />
            ))}
          </div>
        ) : null}
        {message.body ? (
          <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.body}</p>
        ) : null}
        <div
          className={`mt-2 flex justify-end gap-2 text-[10px] ${studio ? 'text-neutral-400' : 'text-muted-foreground'}`}
        >
          <time>{formatTime(message.createdAt)}</time>
          {message.status === 'PENDING' ? <span>Ожидает отправки</span> : null}
          {message.status === 'ERROR' ? <span className="text-red-400">Ошибка</span> : null}
        </div>
      </div>
    </div>
  );
}

function ChatImage({
  accessKey,
  attachment,
  conversationId,
}: {
  accessKey: string;
  attachment: ChatImageAttachment;
  conversationId: string;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const image = useQuery({
    queryFn: () => getDesktopApi().chats.image(getSessionToken(), conversationId, attachment.id),
    queryKey: ['chat-image', accessKey, conversationId, attachment.id],
    staleTime: 60 * 60_000,
  });
  if (image.isError) {
    return (
      <div
        className="flex min-h-28 items-center justify-center gap-2 rounded-xl border border-current/15 bg-black/5 px-4 text-xs opacity-75"
        role="img"
      >
        <ImageOff className="size-4" />
        Изображение недоступно
      </div>
    );
  }
  if (!image.data) {
    return (
      <div className="min-h-28 animate-pulse rounded-xl bg-black/10" role="status">
        <span className="sr-only">Загружаем изображение…</span>
      </div>
    );
  }
  const alternative =
    attachment.originalName ??
    (attachment.kind === 'STICKER' ? 'Стикер ARAVA' : 'Изображение из чата');
  return (
    <>
      <button
        aria-label={`Открыть изображение: ${alternative}`}
        className="block overflow-hidden rounded-xl bg-black/5"
        onClick={() => setPreviewOpen(true)}
        type="button"
      >
        <img
          alt={alternative}
          className={
            attachment.kind === 'STICKER'
              ? 'max-h-40 max-w-40 object-contain'
              : 'max-h-72 w-full object-contain'
          }
          height={attachment.height}
          src={image.data.dataUrl}
          width={attachment.width}
        />
      </button>
      <Dialog
        closeLabel="Закрыть окно"
        onClose={() => setPreviewOpen(false)}
        open={previewOpen}
        title="Изображение из чата"
      >
        <div className="flex max-h-[75vh] items-center justify-center overflow-auto rounded-2xl bg-neutral-950 p-3">
          <img
            alt={alternative}
            className="max-h-[70vh] max-w-full object-contain"
            src={image.data.dataUrl}
          />
        </div>
      </Dialog>
    </>
  );
}

function roleLabel(role: string): string {
  if (role === 'COACH' || role === 'TRAINER') return 'Тренер';
  if (role === 'CLIENT') return 'Клиент';
  return 'Администратор';
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatShort(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
  }).format(new Date(value));
}
