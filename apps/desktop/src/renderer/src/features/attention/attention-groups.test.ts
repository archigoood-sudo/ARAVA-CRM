import { describe, expect, it } from 'vitest';
import type { AttentionItem } from '@arava/shared';
import { groupAttentionTasks } from './attention-groups';

function item(id: string, route: string): AttentionItem {
  return {
    id,
    actionRoute: route,
    actionLabel: 'Открыть',
    category: 'SUBSCRIPTIONS',
    description: '',
    entityId: id,
    entityType: 'Attendance',
    severity: 'WARNING',
    title: 'Одинаковое имя',
  };
}
describe('attention groups', () => {
  it('combines different categories by student ID and preserves every action and order', () => {
    const entries = [
      item('a', '/students/one?action=attendance-payment&lessonId=first'),
      item('b', '/students/two'),
      { ...item('c', '/students/one?action=subscription'), category: 'PAYMENTS' as const },
    ];
    const result = groupAttentionTasks(entries);
    expect(result).toHaveLength(2);
    expect(result[0]?.items).toEqual([entries[0], entries[2]]);
    expect(result[1]?.items).toEqual([entries[1]]);
  });
  it('does not merge unrelated lessons, payroll, or identical student names', () => {
    const result = groupAttentionTasks([
      item('a', '/attendance/lesson'),
      item('b', '/legacy-payroll/period'),
      item('c', '/students/one'),
      item('d', '/students/two'),
    ]);
    expect(result).toHaveLength(4);
    expect(result[0]?.studentId).toBeUndefined();
  });
  it('handles empty and already filtered lists without adding hidden tasks', () => {
    expect(groupAttentionTasks([])).toEqual([]);
    expect(groupAttentionTasks([item('a', '/students/one')])[0]?.items).toHaveLength(1);
  });
});
