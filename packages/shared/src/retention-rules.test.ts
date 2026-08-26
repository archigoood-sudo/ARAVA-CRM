import type { LeadSummary } from './channels';
import { describe, expect, it } from 'vitest';

import { isLeadResponseOverdue, RETENTION_RULES } from './retention-rules';

const now = new Date('2026-08-26T12:00:00.000Z');
const lead = {
  childName: 'Анна',
  createdAt: new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString(),
  id: 'lead-1',
  originalPhone: '+79990000000',
  phone: '+79990000000',
  source: 'WEBSITE',
  status: 'NEW',
  updatedAt: now.toISOString(),
} satisfies LeadSummary;

describe('retention rules', () => {
  it('marks only an untouched lead older than the centralized response SLA', () => {
    expect(RETENTION_RULES.leadResponseHours).toBe(24);
    expect(isLeadResponseOverdue(lead, now)).toBe(true);
    expect(
      isLeadResponseOverdue(
        { ...lead, createdAt: new Date(now.getTime() - 23 * 60 * 60 * 1000).toISOString() },
        now,
      ),
    ).toBe(false);
    expect(isLeadResponseOverdue({ ...lead, status: 'CONTACTED' }, now)).toBe(false);
  });
});
