import type { PayrollAccrualSummary, PayrollPeriodDetail } from '@arava/shared';

const escape = (value: string | number) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
const money = (value: number) =>
  new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    value / 100,
  ) + ' ₽';
const date = (value: string) => {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()))
    throw new Error('В snapshot сохранена некорректная дата.');
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(parsed);
};
const time = (value: string) =>
  new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const statuses = {
  DRAFT: 'ЧЕРНОВИК',
  CALCULATED: 'РАССЧИТАН',
  APPROVED: 'УТВЕРЖДЁН',
  PAID: 'ВЫПЛАЧЕН',
  CANCELLED: 'ОТМЕНЁН',
};
const categories = {
  REGULAR_ATTENDANCE: 'Обычное посещение',
  MAKEUP: 'Отработка',
  SUBSTITUTION: 'Замена',
  PERSONAL_LESSON: 'Персональное',
  PROMOTIONAL_FREE: 'Промо / бесплатное',
  SINGLE_VISIT: 'Разовое посещение',
  TRIAL: 'Пробное',
};

function rate(row: PayrollAccrualSummary): string {
  if (row.payoutCategory && !row.payoutMode) return 'Не настроено';
  if (row.payoutMode === 'NO_PAYOUT') return 'NO_PAYOUT · 0 ₽';
  if (row.payoutMode === 'PERCENTAGE' || row.type === 'PERCENT_OF_REVENUE')
    return `${row.payoutPercentage === undefined ? 'Процент не сохранён' : `${String(row.payoutPercentage).replace('.', ',')}%`}; база ${row.revenueBase === undefined ? 'не сохранена' : money(row.revenueBase)}`;
  const suffix =
    row.payoutMode === 'FIXED_PER_ATTENDANCE' || row.type === 'PER_ATTENDEE'
      ? '/ ученик'
      : row.type === 'FIXED_MONTHLY'
        ? '/ месяц'
        : row.type === 'COMBINED'
          ? '(комб.)'
          : '/ занятие';
  return `${money(row.payoutAmount ?? row.baseAmount)} ${suffix}`;
}

/** Presentation only. All amounts, dates and attribution come from the calculation snapshot. */
export function buildPayrollDocumentHtml(period: PayrollPeriodDetail): string {
  if (!period.trainerId || !period.trainerName)
    throw new Error('В расчёте не сохранён snapshot конкретного тренера.');
  if (period.accruals.some((row) => row.coachId !== period.trainerId))
    throw new Error('В расчёте есть начисления другого тренера.');
  const lessons = period.accruals
    .filter((row) => Boolean(row.lessonId) || Boolean(row.lessonStartsAt))
    .map((row) => {
      const lessonStartsAt = row.lessonStartsAt;
      if (!lessonStartsAt)
        throw new Error(
          'В старом snapshot отсутствует дата занятия. Печать по текущему расписанию запрещена.',
        );
      return { ...row, lessonStartsAt };
    })
    .sort((a, b) => a.lessonStartsAt.localeCompare(b.lessonStartsAt) || a.id.localeCompare(b.id));
  if (lessons.some((row) => !row.lessonStartsAt))
    throw new Error(
      'В старом snapshot отсутствует дата занятия. Печать по текущему расписанию запрещена.',
    );
  const lessonTotal = lessons.reduce((sum, row) => sum + row.calculatedAmount, 0);
  const extras = period.accruals
    .filter((row) => !row.lessonId && !row.lessonStartsAt)
    .map((row) => ({
      label:
        row.comment ??
        (row.type === 'FIXED_MONTHLY' ? 'Ежемесячное начисление' : 'Дополнительное начисление'),
      amount: row.finalAmount,
    }));
  for (const row of lessons)
    if (row.manualAdjustment !== 0)
      extras.push({
        label: `Корректировка ${date(row.lessonStartsAt)}: ${row.comment ?? 'Сохранённая корректировка'}`,
        amount: row.manualAdjustment,
      });
  const additionalTotal = extras.reduce((sum, row) => sum + row.amount, 0);
  if (lessonTotal + additionalTotal !== period.totalAmount)
    throw new Error('Итог snapshot не совпадает с начислениями.');
  const rows = lessons
    .map((row) => {
      const basis = [
        row.payoutCategory ? categories[row.payoutCategory] : 'По расчёту',
        row.manualAdditionReason ? `Добавлено вручную: ${row.manualAdditionReason}` : row.comment,
        row.payoutCategory && !row.payoutMode ? 'Не настроено' : undefined,
      ]
        .filter(Boolean)
        .join('. ');
      return `<tr data-lesson="${escape(row.id)}"><td class="nowrap">${date(row.lessonStartsAt)}</td><td>${escape(row.groupName ?? 'Название не сохранено')}</td><td class="nowrap">${time(row.lessonStartsAt)}</td><td>${escape(basis)}</td><td class="number">${String(row.attendeeCount ?? 0)}</td><td>${escape(rate(row))}</td><td class="number">${escape(money(row.calculatedAmount))}</td></tr>`;
    })
    .join('');
  return `<!doctype html><html lang="ru"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Расчётный лист ${escape(period.sheetNumber ?? period.id)}</title><style>
@page { size: A4 portrait; margin: 12mm 12mm 17mm; }
* { box-sizing: border-box; } body { margin: 0; color: #000; background: #fff; font: 9pt/1.2 'Times New Roman', serif; }
h1 { font-size: 15pt; margin: 0 0 3mm; } p { margin: 1.5mm 0; } header { margin-bottom: 4mm; } .studio { font-size: 10pt; letter-spacing: 1pt; margin-bottom: 2mm; }
table { border-collapse: collapse; width: 100%; table-layout: fixed; } thead { display: table-header-group; } th, td { border: .2mm solid #888; padding: 1.2mm 1mm; vertical-align: top; overflow-wrap: anywhere; } th { font-weight: bold; text-align: left; border-color: #333; } tr { break-inside: avoid; page-break-inside: avoid; } .number { text-align: right; } .nowrap { white-space: nowrap; } .extras { margin-top: 4mm; } h2 { font-size: 10pt; margin: 0 0 2mm; }
.closing { break-inside: avoid; page-break-inside: avoid; margin-top: 4mm; } .totals { width: 95mm; margin-left: auto; } .totals td { border: none; padding: 1mm 0; } .grand td { border-top: .4mm solid #000; font-weight: bold; font-size: 11pt; padding-top: 2mm; } .metadata { margin-top: 3mm; font-size: 8pt; } .signatures { display: flex; justify-content: space-between; gap: 8mm; margin-top: 8mm; padding-bottom: 3mm; } .signature { flex: 1; white-space: nowrap; }
</style></head><body><header><div class="studio">АРАВА · Студия танца</div><h1>РАСЧЁТНЫЙ ЛИСТ № ${escape(period.sheetNumber ?? 'не присвоен')}</h1><p>Расчётный период: ${date(period.dateFrom)} — ${date(period.dateTo)}</p><p>Сотрудник: <b>${escape(period.trainerName)}</b></p><p>Должность/роль: тренер</p></header>
<table aria-label="Занятия"><colgroup><col style="width:11%"><col style="width:21%"><col style="width:8%"><col style="width:22%"><col style="width:8%"><col style="width:17%"><col style="width:13%"></colgroup><thead><tr><th>Дата</th><th>Группа</th><th>Время</th><th>Статус/основание</th><th>Ученики</th><th>Ставка</th><th>Сумма</th></tr></thead><tbody>${rows || '<tr><td colspan="7">Нет начислений по занятиям</td></tr>'}</tbody></table>
${extras.length ? `<section class="extras"><h2>Дополнительные начисления</h2><table><thead><tr><th>Основание</th><th style="width:25%">Сумма</th></tr></thead><tbody>${extras.map((row) => `<tr><td>${escape(row.label)}</td><td class="number">${escape(money(row.amount))}</td></tr>`).join('')}</tbody></table></section>` : ''}
<section class="closing"><table class="totals"><tbody><tr><td>Итого за занятия</td><td class="number">${escape(money(lessonTotal))}</td></tr><tr><td>Дополнительные начисления</td><td class="number">${escape(money(additionalTotal))}</td></tr><tr class="grand"><td>ИТОГО К ВЫПЛАТЕ</td><td class="number">${escape(money(period.totalAmount))}</td></tr></tbody></table><p class="metadata">Дата формирования: ${date(period.createdAt)} · Статус расчёта: ${statuses[period.status]}</p><div class="signatures"><div class="signature">Подпись руководителя __________</div><div class="signature">Подпись сотрудника __________</div></div></section></body></html>`;
}

export const payrollPdfOptions = {
  pageSize: 'A4' as const,
  landscape: false,
  preferCSSPageSize: true,
  printBackground: false,
  displayHeaderFooter: true,
  headerTemplate: '<span></span>',
  footerTemplate:
    '<div style="font-family:serif;font-size:8px;width:100%;text-align:center;color:#000">Страница <span class="pageNumber"></span> из <span class="totalPages"></span></div>',
  margins: { top: 12 / 25.4, bottom: 17 / 25.4, left: 12 / 25.4, right: 12 / 25.4 },
};
