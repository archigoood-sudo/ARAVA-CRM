import { REPORT_KINDS, type ReportKind, type ReportQuery } from '@arava/shared';
import {
  Button,
  Card,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@arava/ui';
import { useQuery } from '@tanstack/react-query';
import { Download, FileSpreadsheet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { getDesktopApi } from '../../lib/desktop-api';
import { getSessionToken } from '../../stores/auth-store';

const labels: Record<ReportKind, string> = {
  ATTENDANCE_BY_GROUP: 'Посещаемость по группам',
  CASH_FLOW: 'Движение денежных средств',
  GROUP_OCCUPANCY: 'Заполняемость групп',
  INCOME_EXPENSES: 'Доходы и расходы',
  PAYROLL_BY_COACH: 'Зарплата тренеров',
  PROFIT_BY_BRANCH: 'Прибыль по филиалам',
  SUBSCRIPTIONS_DEBTS: 'Абонементы и задолженность',
};
function dateInput(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}
export function ReportsPage() {
  const now = new Date();
  const [kind, setKind] = useState<ReportKind>('CASH_FLOW');
  const [dateFrom, setDateFrom] = useState(
    dateInput(new Date(now.getFullYear(), now.getMonth(), 1)),
  );
  const [dateTo, setDateTo] = useState(dateInput(now));
  const [branchId, setBranchId] = useState('');
  const query = useMemo<ReportQuery>(
    () => ({
      branchId: branchId || undefined,
      dateFrom: new Date(`${dateFrom}T00:00:00`).toISOString(),
      dateTo: new Date(`${dateTo}T23:59:59`).toISOString(),
      kind,
    }),
    [branchId, dateFrom, dateTo, kind],
  );
  const report = useQuery({
    queryFn: () => getDesktopApi().reports.get(getSessionToken(), query),
    queryKey: ['report', query],
  });
  const branches = useQuery({
    queryFn: () => getDesktopApi().branches.list(getSessionToken()),
    queryKey: ['branches'],
  });
  const download = async () => {
    const file = await getDesktopApi().reports.exportCsv(getSessionToken(), query);
    const blob = new Blob([file.content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.filename;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <main className="mx-auto w-full max-w-[1540px] animate-fade-in p-9 pb-14">
      <PageHeader
        action={
          <Button onClick={() => void download()}>
            <Download className="size-4" />
            Выгрузить CSV
          </Button>
        }
        description="Готовые управленческие выборки с русскими заголовками в UTF-8."
        title="Отчёты"
      />
      <Card className="mb-5 grid grid-cols-4 gap-3 p-4">
        <Label>
          Отчёт
          <Select onChange={(event) => setKind(event.target.value as ReportKind)} value={kind}>
            {REPORT_KINDS.map((item) => (
              <option key={item} value={item}>
                {labels[item]}
              </option>
            ))}
          </Select>
        </Label>
        <Label>
          Филиал
          <Select onChange={(event) => setBranchId(event.target.value)} value={branchId}>
            <option value="">Все филиалы</option>
            {branches.data?.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </Select>
        </Label>
        <Label>
          С даты
          <Input
            onChange={(event) => setDateFrom(event.target.value)}
            type="date"
            value={dateFrom}
          />
        </Label>
        <Label>
          По дату
          <Input onChange={(event) => setDateTo(event.target.value)} type="date" value={dateTo} />
        </Label>
      </Card>
      {!report.data?.rows.length ? (
        <EmptyState
          description="За выбранный период данных для этого отчёта нет."
          icon={FileSpreadsheet}
          title="Отчёт пока пуст"
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="border-b border-border p-5">
            <h2 className="text-xl font-semibold">{report.data.title}</h2>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                {report.data.headers.map((header) => (
                  <TableHead key={header}>{header}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.data.rows.map((row, index) => (
                <TableRow key={index}>
                  {row.map((cell, cellIndex) => (
                    <TableCell key={`${String(index)}-${String(cellIndex)}`}>
                      {typeof cell === 'number' ? cell.toLocaleString('ru-RU') : cell}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </main>
  );
}
