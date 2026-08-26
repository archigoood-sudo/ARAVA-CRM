import type { GroupMembershipStudentOption } from '@arava/shared';
import { Button, Checkbox, Dialog, EmptyState, Input } from '@arava/ui';
import { Search, UserPlus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

function studentName(student: GroupMembershipStudentOption): string {
  return [student.lastName, student.firstName, student.middleName].filter(Boolean).join(' ');
}

export function GroupAddStudentsDialog({
  onClose,
  onContinue,
  open,
  students,
}: {
  onClose: () => void;
  onContinue: (studentIds: string[]) => void;
  open: boolean;
  students: GroupMembershipStudentOption[];
}) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (!open) return;
    setSearch('');
    setSelected(new Set());
  }, [open]);
  const visible = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('ru-RU');
    if (!term) return students;
    return students.filter((student) =>
      studentName(student).toLocaleLowerCase('ru-RU').includes(term),
    );
  }, [search, students]);
  const allVisibleSelected = visible.length > 0 && visible.every(({ id }) => selected.has(id));
  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  return (
    <Dialog
      closeLabel="Закрыть выбор учеников"
      description={`Выбрано: ${String(selected.size)}`}
      onClose={onClose}
      open={open}
      title="Добавить учеников"
      wide
    >
      <div className="space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Поиск учеников для добавления"
            className="pl-9"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Имя или фамилия"
            value={search}
          />
        </div>
        {visible.length ? (
          <>
            <label className="flex items-center gap-3 rounded-xl border border-border px-4 py-3 text-sm font-semibold">
              <Checkbox
                checked={allVisibleSelected}
                onChange={() => {
                  setSelected((current) => {
                    const next = new Set(current);
                    for (const student of visible) {
                      if (allVisibleSelected) next.delete(student.id);
                      else next.add(student.id);
                    }
                    return next;
                  });
                }}
              />
              Выбрать найденных: {String(visible.length)}
            </label>
            <div className="max-h-[45vh] space-y-2 overflow-y-auto pr-1">
              {visible.map((student) => {
                const name = studentName(student);
                return (
                  <label
                    className="flex items-center gap-3 rounded-2xl border border-border px-4 py-3 hover:bg-muted/40"
                    key={student.id}
                  >
                    <Checkbox
                      aria-label={`Выбрать ${name}`}
                      checked={selected.has(student.id)}
                      onChange={() => toggle(student.id)}
                    />
                    <span className="text-sm font-semibold">{name}</span>
                  </label>
                );
              })}
            </div>
          </>
        ) : (
          <EmptyState
            description={
              search ? 'Измените запрос.' : 'Все доступные ученики уже состоят в группе.'
            }
            icon={UserPlus}
            title={search ? 'Ничего не найдено' : 'Нет учеников для добавления'}
          />
        )}
        <div className="flex justify-end gap-3">
          <Button onClick={onClose} variant="outline">
            Отмена
          </Button>
          <Button disabled={selected.size === 0} onClick={() => onContinue([...selected])}>
            Продолжить
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
