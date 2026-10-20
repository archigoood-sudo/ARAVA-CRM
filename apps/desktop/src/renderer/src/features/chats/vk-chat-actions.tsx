import type { ChatSummary, VkAction } from '@arava/shared';
import { Button, Input } from '@arava/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { getDesktopApi } from '../../lib/desktop-api';
import { getErrorMessage } from '../../lib/errors';
import { getSessionToken } from '../../stores/auth-store';

export function VkChatActions({
  conversation,
  accessKey,
}: {
  conversation: ChatSummary;
  accessKey: string;
}) {
  const client = useQueryClient();
  const [mode, setMode] = useState<'LEAD' | 'STUDENT' | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [studentId, setStudentId] = useState('');
  const students = useQuery({
    queryKey: ['vk-link-students', accessKey, conversation.branchId],
    enabled: mode === 'STUDENT',
    queryFn: () =>
      getDesktopApi().students.options(getSessionToken(), conversation.branchId ?? undefined),
  });
  const mutation = useMutation({
    mutationFn: (input: VkAction) => getDesktopApi().vk.request(getSessionToken(), input),
    onSuccess: () => {
      setMode(null);
      setName('');
      setPhone('');
      setStudentId('');
      void client.invalidateQueries({ queryKey: ['chats', accessKey] });
      void client.invalidateQueries({ queryKey: ['student-communication', accessKey] });
    },
  });
  return (
    <div className="space-y-2 border-b border-border px-6 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span>ВКонтакте · только сотрудники CRM</span>
        {conversation.leadId ? (
          <Link className="underline" to="/leads">
            Открыть заявки
          </Link>
        ) : (
          <Button
            variant="outline"
            onClick={() => {
              mutation.reset();
              setMode(mode === 'LEAD' ? null : 'LEAD');
            }}
          >
            Создать заявку
          </Button>
        )}
        <Button
          variant="outline"
          onClick={() => {
            mutation.reset();
            setMode(mode === 'STUDENT' ? null : 'STUDENT');
          }}
        >
          Связать с учеником
        </Button>
      </div>
      {mode === 'LEAD' ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate({
              action: 'CREATE_LEAD',
              conversationId: conversation.id,
              name,
              phone,
            });
          }}
        >
          <label>
            Имя для заявки
            <Input
              required
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Телефон
            <Input
              required
              type="tel"
              maxLength={32}
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </label>
          <Button type="submit" disabled={mutation.isPending}>
            Подтвердить создание заявки
          </Button>
          <p className="basis-full text-xs text-muted-foreground">
            Ученик и абонемент не создаются. Запись на пробное доступна в существующей карточке
            заявки.
          </p>
        </form>
      ) : null}
      {mode === 'STUDENT' ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate({ action: 'LINK_STUDENT', conversationId: conversation.id, studentId });
          }}
        >
          <label>
            Ученик
            <select
              required
              className="ml-2 rounded-xl border border-border bg-background p-2"
              value={studentId}
              onChange={(event) => setStudentId(event.target.value)}
            >
              <option value="">Выберите ученика</option>
              {students.data?.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.lastName} {student.firstName}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" disabled={!studentId || mutation.isPending}>
            Подтвердить связь
          </Button>
          <p className="basis-full text-xs text-muted-foreground">
            Связь добавляет переход к карточке. Она не открывает доступ к личному кабинету и не
            меняет оплаты.
          </p>
        </form>
      ) : null}
      {students.isError && mode === 'STUDENT' ? (
        <p role="alert">Не удалось загрузить список учеников.</p>
      ) : null}
      {mutation.isError ? (
        <p role="alert" className="text-red-600">
          {getErrorMessage(mutation.error, 'Действие не выполнено.')}
        </p>
      ) : null}
      {mutation.isSuccess ? <p role="status">Сохранено.</p> : null}
    </div>
  );
}
