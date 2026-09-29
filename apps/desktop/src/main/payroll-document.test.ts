import { describe, expect, it } from 'vitest';
import type { PayrollPeriodDetail } from '@arava/shared';
import { buildPayrollDocumentHtml, payrollPdfOptions } from './payroll-document';

const fixture = (): PayrollPeriodDetail => ({
  id: 'period',
  trainerId: 'substitute',
  trainerName: 'Тренер Замещающий',
  sheetNumber: 'ЗП-2026-0042',
  dateFrom: '2026-08-01',
  dateTo: '2026-08-31',
  createdAt: '2026-09-01T10:00:00Z',
  updatedAt: '2026-09-01T10:00:00Z',
  createdByName: 'OWNER',
  status: 'APPROVED',
  totalAmount: 55000,
  pendingAttendance: [],
  unconfiguredPayoutCount: 0,
  accruals: [
    {
      id: 'row',
      coachId: 'substitute',
      coachName: 'Тренер Замещающий',
      branchId: 'branch',
      branchName: 'Центр',
      lessonId: 'lesson',
      lessonStartsAt: '2026-08-17T10:00:00Z',
      groupName: 'Танцы <script>alert(1)</script>',
      type: 'FIXED_PER_LESSON',
      payoutCategory: 'SUBSTITUTION',
      payoutMode: 'FIXED_PER_LESSON',
      payoutAmount: 50000,
      baseAmount: 50000,
      calculatedAmount: 50000,
      manualAdjustment: 5000,
      finalAmount: 55000,
      attendeeCount: 8,
      manualAdditionReason: 'Уточнено владельцем',
      comment: 'Доплата',
    },
  ],
});

describe('isolated payroll print document', () => {
  it('prints canonical dates, substitute, manual reason and totals without desktop chrome', () => {
    const html = buildPayrollDocumentHtml(fixture());
    expect(html).toContain('17.08.2026');
    expect(html).toContain('01.08.2026 — 31.08.2026');
    expect(html).toContain('ЗП-2026-0042');
    expect(html).toContain('Тренер Замещающий');
    expect(html).toContain('Добавлено вручную: Уточнено владельцем');
    expect(html).toContain('Замена');
    expect(html).toContain('500,00 ₽');
    expect(html).toContain('550,00 ₽');
    expect(html).toContain('50,00 ₽');
    expect(html).toContain('Подпись руководителя');
    expect(html).toContain('Подпись сотрудника');
    expect(html).not.toMatch(/<script|<button|<nav|sidebar|window\.print|visibility:\s*hidden/u);
    expect(html).toContain('&lt;script&gt;');
  });
  it('keeps A4 readable with repeating headers and real page counters', () => {
    const html = buildPayrollDocumentHtml(fixture());
    expect(html).toContain('size: A4 portrait');
    expect(html).toContain('table-header-group');
    expect(html).toContain('break-inside: avoid');
    expect(html).not.toMatch(/min-width|transform:\s*scale|zoom:/u);
    expect(payrollPdfOptions.footerTemplate).toContain('pageNumber');
    expect(payrollPdfOptions.footerTemplate).toContain('totalPages');
  });
  it('does not invent missing dates, mix trainers or repair mismatching money', () => {
    const period = fixture();
    const row = period.accruals[0];
    if (!row || !period.trainerId) throw new Error('Incomplete test fixture');
    row.lessonStartsAt = undefined;
    expect(() => buildPayrollDocumentHtml(period)).toThrow('отсутствует дата');
    row.lessonStartsAt = '2026-08-17T10:00:00Z';
    row.coachId = 'other';
    expect(() => buildPayrollDocumentHtml(period)).toThrow('другого тренера');
    row.coachId = period.trainerId;
    period.totalAmount++;
    expect(() => buildPayrollDocumentHtml(period)).toThrow('не совпадает');
  });
  it('uses the same frozen content on repeated generation and distinguishes unset from NO_PAYOUT', () => {
    const period = fixture();
    expect(buildPayrollDocumentHtml(period)).toBe(
      buildPayrollDocumentHtml(structuredClone(period)),
    );
    const row = period.accruals[0];
    if (!row || !period.trainerId) throw new Error('Incomplete test fixture');
    row.payoutMode = undefined;
    expect(buildPayrollDocumentHtml(period)).toContain('Не настроено');
    row.payoutMode = 'NO_PAYOUT';
    expect(buildPayrollDocumentHtml(period)).toContain('NO_PAYOUT');
  });
});
