import type { LeadSource, LeadStatus, LeadSummary, StudentInput } from '@arava/shared';

export const leadStatusLabels: Record<LeadStatus, string> = {
  CONTACTED: 'Связались',
  CONVERTED: 'Стал клиентом',
  NEW: 'Новая',
  NOT_RELEVANT: 'Не актуально',
  NO_ANSWER: 'Не дозвонились',
  REJECTED: 'Отказ',
  TRIAL_ATTENDED: 'Пришёл на пробное',
  TRIAL_BOOKED: 'Записан на пробное',
};

export const leadSourceLabels: Record<LeadSource, string> = {
  MANUAL: 'Вручную',
  OTHER: 'Другой',
  PHONE: 'Телефон',
  VK: 'ВКонтакте',
  WEBSITE: 'Сайт',
};

export function leadAttentionKey(leadId: string): string {
  return `lead:${leadId}`;
}

export function studentPrefill(
  lead: LeadSummary,
  branches: { id: string }[],
): Partial<StudentInput> {
  const parts = lead.childName.trim().split(/\s+/u);
  const firstName = parts.length > 1 ? (parts.at(-1) ?? '') : (parts[0] ?? '');
  const lastName = parts.length > 1 ? parts.slice(0, -1).join(' ') : 'Не указана';
  const notes = [
    `Заявка ${leadSourceLabels[lead.source].toLocaleLowerCase('ru-RU')}.`,
    lead.childAge ? `Возраст: ${String(lead.childAge)}.` : '',
    lead.direction ? `Направление: ${lead.direction}.` : '',
    lead.note ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  const branchId = branches.some(({ id }) => id === lead.branchCrmId)
    ? lead.branchCrmId
    : branches[0]?.id;
  return {
    ...(branchId ? { branchId } : {}),
    firstName,
    lastName,
    notes,
    ...(!lead.parentName ? { phone: lead.phone } : {}),
    status: 'TRIAL',
  };
}
