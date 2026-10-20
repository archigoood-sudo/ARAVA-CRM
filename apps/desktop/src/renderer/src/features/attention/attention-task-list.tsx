import { formatDate, type AttentionItem } from '@arava/shared';
import { AttentionCard, Badge, Button } from '@arava/ui';
import { useQuery } from '@tanstack/react-query';
import { BellRing, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getDesktopApi } from '../../lib/desktop-api';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';
import { groupAttentionTasks } from './attention-groups';

export function AttentionTaskList({ items }: { items: AttentionItem[] }) {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const groups = groupAttentionTasks(items);
  const students = useQuery({
    enabled: groups.some((group) => Boolean(group.studentId)),
    queryKey: ['attention', 'student-labels', user?.id, user?.role, user?.branchIds],
    queryFn: () => getDesktopApi().students.options(getSessionToken()),
  });
  const names = new Map(
    students.data?.map((student) => [student.id, `${student.lastName} ${student.firstName}`]),
  );
  const renderItem = (item: AttentionItem) => (
    <AttentionCard
      key={item.id}
      action={
        <Button size="small" variant="secondary" onClick={() => navigate(item.actionRoute)}>
          {item.actionLabel}
          <ChevronRight className="size-4" />
        </Button>
      }
      description={item.description}
      icon={<BellRing className="size-4" />}
      meta={[item.branchName, item.dueAt ? formatDate(item.dueAt, { dateStyle: 'short' }) : '']
        .filter(Boolean)
        .join(' · ')}
      title={item.title}
      tone={
        item.severity === 'CRITICAL' ? 'critical' : item.severity === 'INFO' ? 'info' : 'warning'
      }
    />
  );
  return (
    <>
      {groups.map((group) =>
        group.studentId ? (
          <details
            key={group.key}
            data-testid="attention-student-group"
            data-student-id={group.studentId}
            className="rounded-2xl border border-border bg-surface"
          >
            <summary className="cursor-pointer rounded-2xl px-4 py-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
              {names.get(group.studentId) ?? group.items[0]?.title ?? 'Ученик'}
              <Badge className="ml-3">Задач: {group.items.length}</Badge>
              {group.items.some((item) => item.severity === 'CRITICAL') ? (
                <span className="ml-2 text-red-600">Критично</span>
              ) : null}
            </summary>
            <div className="space-y-2 border-t border-border p-3">
              {group.items.map(renderItem)}
            </div>
          </details>
        ) : (
          group.items.map(renderItem)
        ),
      )}
    </>
  );
}
