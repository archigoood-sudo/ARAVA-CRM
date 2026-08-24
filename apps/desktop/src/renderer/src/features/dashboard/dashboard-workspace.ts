import type { AttentionItem, ChatSummary, DashboardStats, LeadSummary } from '@arava/shared';

export interface DashboardActionItem {
  actionLabel: string;
  actionRoute: string;
  description: string;
  id: string;
  meta?: string | undefined;
  priority: 'RED' | 'YELLOW' | 'BLUE';
  title: string;
}

export interface DashboardWorkspace {
  attention: DashboardActionItem[];
  upcoming: DashboardActionItem[];
  today: DashboardActionItem[];
}

const priorityOrder = { BLUE: 2, RED: 0, YELLOW: 1 } as const;

function fromAttention(item: AttentionItem): DashboardActionItem {
  return {
    actionLabel: item.actionLabel,
    actionRoute: item.actionRoute,
    description: item.description,
    id: item.id,
    meta: item.branchName,
    priority:
      item.severity === 'CRITICAL' ? 'RED' : item.severity === 'WARNING' ? 'YELLOW' : 'BLUE',
    title: item.title,
  };
}

function sorted(items: DashboardActionItem[]): DashboardActionItem[] {
  return items.sort(
    (left, right) =>
      priorityOrder[left.priority] - priorityOrder[right.priority] ||
      left.title.localeCompare(right.title, 'ru'),
  );
}

export function buildDashboardWorkspace({
  attention,
  chats,
  leads,
  now,
  stats,
}: {
  attention: AttentionItem[];
  chats: ChatSummary[];
  leads: LeadSummary[];
  now: Date;
  stats: DashboardStats;
}): DashboardWorkspace {
  const dayEnd = new Date(now);
  dayEnd.setHours(23, 59, 59, 999);
  const upcomingEnd = new Date(dayEnd.getTime() + 7 * 86_400_000);
  const used = new Set<string>();
  const take = (items: DashboardActionItem[], maximum: number) => {
    const selected: DashboardActionItem[] = [];
    for (const item of sorted(items)) {
      if (used.has(item.id)) continue;
      used.add(item.id);
      selected.push(item);
      if (selected.length === maximum) break;
    }
    return selected;
  };

  const attentionItems = take(
    attention
      .filter(
        (item) =>
          item.severity === 'CRITICAL' ||
          (!item.dueAt && (item.category === 'PAYMENTS' || item.category === 'SUBSCRIPTIONS')),
      )
      .map(fromAttention),
    6,
  );

  const leadItems: DashboardActionItem[] = leads
    .filter(({ status }) => status === 'NEW')
    .map((lead) => ({
      actionLabel: 'Открыть заявку',
      actionRoute: `/leads?leadId=${encodeURIComponent(lead.id)}`,
      description: [lead.parentName, lead.phone, lead.direction].filter(Boolean).join(' · '),
      id: `lead:${lead.id}`,
      priority: 'YELLOW',
      title: `Новая заявка: ${lead.childName}`,
    }));
  const chatItems: DashboardActionItem[] = chats
    .filter(({ unreadCount }) => unreadCount > 0)
    .map((chat) => ({
      actionLabel: 'Открыть чат',
      actionRoute: `/chats?conversationId=${encodeURIComponent(chat.id)}`,
      description: `${String(chat.unreadCount)} непрочитанных · ${chat.lastMessage ?? chat.subtitle}`,
      id: `chat:${chat.id}`,
      priority: 'YELLOW',
      title: chat.title,
    }));
  const dueToday = attention
    .filter((item) => item.dueAt && new Date(item.dueAt) <= dayEnd)
    .map(fromAttention);
  const trialItem: DashboardActionItem[] = stats.trialsToday
    ? [
        {
          actionLabel: 'Открыть посещения',
          actionRoute: '/attendance',
          description: `Сегодня ожидается пробных посещений: ${String(stats.trialsToday)}.`,
          id: 'today:trials',
          priority: 'YELLOW',
          title: 'Пробные занятия сегодня',
        },
      ]
    : [];
  const todayItems = take([...leadItems, ...chatItems, ...trialItem, ...dueToday], 8);

  const upcomingItems = take(
    attention
      .filter((item) => {
        if (!item.dueAt) return false;
        const dueAt = new Date(item.dueAt);
        return dueAt > dayEnd && dueAt <= upcomingEnd;
      })
      .map(fromAttention),
    6,
  );
  return { attention: attentionItems, today: todayItems, upcoming: upcomingItems };
}
