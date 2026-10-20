import { formatDate, type AttendanceWorkspaceLesson } from '@arava/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getDesktopApi } from '../../lib/desktop-api';
import { getSessionToken } from '../../stores/auth-store';
import { attendanceConflicts } from './attendance-conflicts';

export function AttendanceConflictLinks({ occurrence }: { occurrence: AttendanceWorkspaceLesson }) {
  const token = getSessionToken();
  const existing = useQuery({
    queryKey: [
      'attendance-opening-conflicts',
      token,
      occurrence.groupId,
      occurrence.startsAt,
      occurrence.endsAt,
    ],
    queryFn: async () =>
      attendanceConflicts(
        occurrence,
        await getDesktopApi().lessons.list(token, {
          branchId: occurrence.branchId,
          groupId: occurrence.groupId,
          dateFrom: new Date(0).toISOString(),
          dateTo: occurrence.endsAt,
        }),
      ),
    staleTime: 0,
  });
  if (existing.isPending) return <p>Ищем существующие занятия этой группы…</p>;
  if (existing.isError)
    return <p>Не удалось проверить существующие занятия. Ничего не изменено.</p>;
  if (existing.data.length === 0) return null;
  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-3 text-foreground">
      <p className="font-semibold">В это время уже есть занятие этой группы</p>
      <p>
        Выберите существующее занятие для отметки посещений. Новое занятие не создаётся; расписание
        и данные не изменяются.
      </p>
      {existing.data.map((lesson) => (
        <div key={lesson.id} className="space-y-1 border-t border-border pt-2">
          <p>
            {lesson.groupName} ·{' '}
            {formatDate(lesson.startsAt, {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
            –{formatDate(lesson.endsAt, { hour: '2-digit', minute: '2-digit' })}
          </p>
          <p>
            {lesson.substituteCoachName ?? lesson.coachName ?? 'Тренер не указан'} ·{' '}
            {lesson.status === 'COMPLETED' ? 'Проведено' : 'Запланировано'} · Отмечено{' '}
            {lesson.attendanceMarked} из {lesson.attendanceExpected}
          </p>
          <Link
            className="inline-block rounded-lg border border-border px-3 py-2 font-semibold underline"
            to={'/attendance/' + lesson.id}
          >
            Открыть существующее занятие
          </Link>
        </div>
      ))}
    </div>
  );
}
