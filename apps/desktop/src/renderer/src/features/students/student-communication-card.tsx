import { formatDate, type AttentionItem, type StudentChatSummary } from '@arava/shared';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@arava/ui';
import { useQuery } from '@tanstack/react-query';
import { Globe2, MessageCircle, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';

import { getDesktopApi } from '../../lib/desktop-api';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken } from '../../stores/auth-store';
import {
  isCommunicationAttention,
  isMessageToday,
  studentChatLink,
} from './student-communication-model';

const authorLabels: Record<NonNullable<StudentChatSummary['lastMessageAuthor']>, string> = {
  ADMIN: 'Администратор',
  CLIENT: 'Клиент',
  TRAINER: 'Тренер',
  UNKNOWN: 'Участник',
};

export function StudentCommunicationCard({
  accessKey,
  attentionItems,
  studentId,
}: {
  accessKey: string;
  attentionItems: AttentionItem[];
  studentId: string;
}) {
  const summary = useQuery({
    queryFn: () => getDesktopApi().chats.studentSummary(getSessionToken(), studentId),
    queryKey: queryKeys.studentCommunication(accessKey, studentId),
    refetchInterval: 20_000,
    retry: false,
  });
  const communicationAttention = attentionItems.filter(isCommunicationAttention);
  const chatLink =
    summary.data?.state === 'AVAILABLE' && summary.data.conversationId
      ? studentChatLink(studentId, summary.data.conversationId)
      : undefined;

  return (
    <Card data-testid="student-communication">
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 px-4 pb-2 pt-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <MessageCircle className="size-5" /> Общение
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">Личный диалог и причины для связи</p>
        </div>
        <Button
          aria-label="Обновить общение"
          disabled={summary.isFetching}
          onClick={() => void summary.refetch()}
          size="icon"
          variant="ghost"
        >
          <RefreshCw className={summary.isFetching ? 'size-4 animate-spin' : 'size-4'} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 px-4 pb-4">
        {summary.isLoading ? (
          <p className="text-sm text-muted-foreground">Проверяем личную переписку…</p>
        ) : summary.isError ? (
          <OfflineState />
        ) : summary.data ? (
          <SummaryState chatLink={chatLink} summary={summary.data} />
        ) : null}

        {communicationAttention.length ? (
          <div className="border-t border-border pt-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Причины для связи
            </p>
            <div className="mt-2 grid gap-2">
              {communicationAttention.slice(0, 4).map((item) => (
                <div className="rounded-xl bg-muted/60 p-3" key={item.id}>
                  <p className="text-sm font-semibold">{item.title}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {item.description}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Link className="text-xs font-semibold hover:underline" to={item.actionRoute}>
                      {item.actionLabel}
                    </Link>
                    {chatLink ? (
                      <Link className="text-xs font-semibold hover:underline" to={chatLink}>
                        Написать
                      </Link>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SummaryState({
  chatLink,
  summary,
}: {
  chatLink: string | undefined;
  summary: StudentChatSummary;
}) {
  if (summary.state === 'OFFLINE') return <OfflineState />;
  if (summary.state === 'INACCESSIBLE') return null;
  if (summary.state === 'AMBIGUOUS')
    return (
      <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
        Найдено несколько связанных личных переписок. Откройте раздел «Чаты» и выберите контакт
        явно.
      </div>
    );
  if (summary.state === 'NO_CHAT')
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/60 p-3">
        <div>
          <p className="font-semibold">Личной переписки пока нет</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Личный кабинет или чат клиента ещё не подключён.
          </p>
        </div>
        <Button
          onClick={() =>
            document.getElementById('client-web-access')?.scrollIntoView({ behavior: 'smooth' })
          }
          size="small"
          variant="outline"
        >
          <Globe2 className="size-4" /> Личный кабинет
        </Button>
      </div>
    );

  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-background p-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {summary.unreadCount ? (
            <Badge className="bg-accent text-neutral-950">
              {summary.unreadCount} {unreadLabel(summary.unreadCount)}
            </Badge>
          ) : (
            <Badge>
              {summary.lastMessageAt && isMessageToday(summary.lastMessageAt)
                ? 'Последнее сообщение сегодня'
                : 'Личный чат'}
            </Badge>
          )}
          {summary.lastMessageAt ? (
            <span className="text-xs text-muted-foreground">
              {formatDate(summary.lastMessageAt, { dateStyle: 'medium', timeStyle: 'short' })}
              {summary.lastMessageAuthor ? ` · ${authorLabels[summary.lastMessageAuthor]}` : ''}
            </span>
          ) : null}
        </div>
        <p className="mt-2 line-clamp-2 text-sm text-foreground">
          {summary.lastMessagePreview ?? 'Переписка ещё не началась'}
        </p>
      </div>
      {chatLink ? (
        <Link
          className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-accent px-3 text-sm font-semibold text-neutral-950 shadow-accent transition-all hover:bg-accent-strong"
          to={chatLink}
        >
          <MessageCircle className="size-4" /> Написать
        </Link>
      ) : null}
    </div>
  );
}

function OfflineState() {
  return (
    <div className="rounded-2xl bg-muted/60 p-4 text-sm text-muted-foreground">
      Нет подключения. Не удалось обновить общение; откройте чат после восстановления связи.
    </div>
  );
}

function unreadLabel(count: number): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return 'непрочитанных';
  if (mod10 === 1) return 'непрочитанное';
  if (mod10 >= 2 && mod10 <= 4) return 'непрочитанных';
  return 'непрочитанных';
}
