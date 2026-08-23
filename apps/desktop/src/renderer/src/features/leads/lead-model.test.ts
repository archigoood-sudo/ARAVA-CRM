import { describe, expect, it } from 'vitest';

import { leadAttentionKey, studentPrefill } from './lead-model';

describe('lead student prefill', () => {
  it('prefills safe fields and keeps a matching warning decision outside automatic merge', () => {
    const input = studentPrefill(
      {
        branchCrmId: 'branch-a',
        childAge: 9,
        childName: 'Иванова Мария',
        createdAt: '2026-08-23T10:00:00.000Z',
        direction: 'Хип-хоп',
        id: 'lead-a',
        note: 'Позвонить вечером',
        originalPhone: '+7 999 123-45-67',
        parentName: 'Анна Иванова',
        phone: '+79991234567',
        source: 'WEBSITE',
        status: 'NEW',
        updatedAt: '2026-08-23T10:00:00.000Z',
      },
      [{ id: 'branch-a' }],
    );

    expect(input).toMatchObject({
      branchId: 'branch-a',
      firstName: 'Мария',
      lastName: 'Иванова',
      status: 'TRIAL',
    });
    expect(input.notes).toContain('Возраст: 9');
    expect(input.notes).toContain('Хип-хоп');
    expect(input).not.toHaveProperty('phone');
  });

  it('uses a stable attention key so refresh does not duplicate the same new lead', () => {
    expect(leadAttentionKey('lead-a')).toBe('lead:lead-a');
    expect(leadAttentionKey('lead-a')).toBe(leadAttentionKey('lead-a'));
    expect(leadAttentionKey('lead-b')).not.toBe(leadAttentionKey('lead-a'));
  });
});
