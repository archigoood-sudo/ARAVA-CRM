import type { AttentionItem } from '@arava/shared';

export interface AttentionTaskGroup {
  key: string;
  studentId?: string;
  items: AttentionItem[];
}

/** Group by stable student identity, never by display name or a financial entity ID. */
export function groupAttentionTasks(items: AttentionItem[]): AttentionTaskGroup[] {
  const groups = new Map<string, AttentionTaskGroup>();
  for (const item of items) {
    const studentId = /^\/students\/([^/?#]+)(?:[?#]|$)/u.exec(item.actionRoute)?.[1];
    const key = studentId ? `student:${studentId}` : `task:${item.id}`;
    const group = groups.get(key);
    if (group) group.items.push(item);
    else groups.set(key, { key, ...(studentId ? { studentId } : {}), items: [item] });
  }
  return [...groups.values()];
}
