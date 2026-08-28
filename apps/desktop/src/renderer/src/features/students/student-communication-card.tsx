import { formatDate, type StudentChatSummary } from '@arava/shared';
import { Badge, Button, Card, CardContent, CardTitle } from '@arava/ui';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Globe2, MessageCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { getDesktopApi } from '../../lib/desktop-api';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken } from '../../stores/auth-store';
import { isMessageToday, studentChatLink } from './student-communication-model';

const authorLabels: Record<NonNullable<StudentChatSummary['lastMessageAuthor']>, string> = {
  ADMIN: 'Администратор',
  CLIENT: 'Клиент',
  TRAINER: 'Тренер',
  UNKNOWN: 'Участник',
};

const suggestionLabels: Record<string, string> = {
  'system:after-trial': 'После пробного',
  'system:lesson-reminder': 'Напомнить о занятии',
  'system:missed-lesson': 'Пропустил занятие',
  'system:payment-reminder': 'Напомнить об оплате',
  'system:return-invitation': 'Пригласить вернуться',
  'system:subscription-ending': 'Абонемент заканчивается',
};

export function StudentWriteButton({
  accessKey,
  studentId,
}: {
  accessKey: string;
  studentId: string;
}) {
  const summary = useStudentCommunication(accessKey, studentId);
  if (summary.data?.state === 'AVAILABLE' && summary.data.conversationId)
    return (
      <LinkButton
        className="border-white/15 bg-white/10 text-white hover:bg-white/15"
        to={studentChatLink(studentId, summary.data.conversationId)}
      >
        <MessageCircle className="size-4" /> Написать
      </LinkButton>
    );
  return null;
}

export function StudentCommunicationCard({
  accessKey,
  studentId,
}: {
  accessKey: string;
  studentId: string;
}) {
  const summary = useStudentCommunication(accessKey, studentId);
  const conversationId =
    summary.data?.state === 'AVAILABLE' && summary.data.conversationId
      ? summary.data.conversationId
      : undefined;
  const chatLink = conversationId ? studentChatLink(studentId, conversationId) : undefined;

  return (
    <Card data-testid="student-communication">
      <details>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 [&::-webkit-details-marker]:hidden">
          <div>
            <CardTitle className="flex items-center gap-2">
              <MessageCircle className="size-5" /> Коммуникация
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Последние сообщения и быстрый переход в чат
            </p>
          </div>
          <ChevronDown className="size-4 text-muted-foreground" />
        </summary>
        <CardContent className="space-y-3 border-t border-border px-4 pb-4 pt-3">
          {summary.isLoading ? (
            <p className="text-sm text-muted-foreground">Проверяем личную переписку…</p>
          ) : summary.isError ? (
            <OfflineState />
          ) : summary.data ? (
            <SummaryState chatLink={chatLink} summary={summary.data} />
          ) : null}

          {chatLink && conversationId && summary.data?.suggestedTemplateIds.length ? (
            <div className="flex flex-wrap gap-2 border-t border-border pt-3">
              {summary.data.suggestedTemplateIds.map((templateId) => (
                <Link
                  className="inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-xs font-semibold hover:bg-muted"
                  key={templateId}
                  to={studentChatLink(studentId, conversationId, templateId)}
                >
                  {suggestionLabels[templateId] ?? 'Написать'}
                </Link>
              ))}
            </div>
          ) : null}
        </CardContent>
      </details>
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
    <div className="space-y-3 rounded-xl border border-border bg-background p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
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
            <MessageCircle className="size-4" /> Открыть чат
          </Link>
        ) : null}
      </div>
      {summary.latestInbound || summary.latestOutbound ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <MessagePreview label="От клиента" message={summary.latestInbound} />
          <MessagePreview label="От студии" message={summary.latestOutbound} />
        </div>
      ) : null}
    </div>
  );
}

function MessagePreview({
  label,
  message,
}: {
  label: string;
  message: StudentChatSummary['latestInbound'] | undefined;
}) {
  if (!message) return null;
  return (
    <div className="min-w-0 rounded-lg bg-muted/60 p-2.5">
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <b>{label}</b>
        <time>{formatDate(message.createdAt, { dateStyle: 'short', timeStyle: 'short' })}</time>
      </div>
      <p className="mt-1 line-clamp-2 break-words text-xs">{message.text}</p>
    </div>
  );
}

function LinkButton({
  children,
  className,
  to,
}: {
  children: ReactNode;
  className?: string;
  to: string;
}) {
  return (
    <Link
      className={`inline-flex h-9 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition ${className ?? ''}`}
      to={to}
    >
      {children}
    </Link>
  );
}

function useStudentCommunication(accessKey: string, studentId: string) {
  return useQuery({
    queryFn: () => getDesktopApi().chats.studentSummary(getSessionToken(), studentId),
    queryKey: queryKeys.studentCommunication(accessKey, studentId),
    refetchInterval: 20_000,
    retry: false,
  });
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
