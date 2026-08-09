import type { BranchSummary, ExpenseCategorySummary, ExpenseInput } from '@arava/shared';
import { Button, Dialog, Input, Label, Select, Textarea } from '@arava/ui';
import { useEffect, useState } from 'react';

function localDateTime() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function ExpenseDialog({
  branches,
  categories,
  error,
  onClose,
  onSave,
  open,
}: {
  branches: BranchSummary[];
  categories: ExpenseCategorySummary[];
  error: string | undefined;
  onClose: () => void;
  onSave: (input: ExpenseInput) => Promise<void>;
  open: boolean;
}) {
  const [branchId, setBranchId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [spentAt, setSpentAt] = useState(localDateTime());
  const [paymentMethod, setPaymentMethod] = useState<ExpenseInput['paymentMethod']>('CASH');
  const [vendor, setVendor] = useState('');
  const [description, setDescription] = useState('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [attachmentPath, setAttachmentPath] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open && !branchId && branches[0]) setBranchId(branches[0].id);
  }, [branchId, branches, open]);
  const availableCategories = categories.filter(
    (category) => !category.branchId || category.branchId === branchId,
  );
  return (
    <Dialog
      closeLabel="Закрыть"
      description="Расход сохраняется черновиком и попадёт в отчёты только после подтверждения."
      onClose={onClose}
      open={open}
      title="Новый расход"
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setSaving(true);
          void onSave({
            amount: Math.round(Number(amount.replace(',', '.')) * 100),
            attachmentPath: attachmentPath || undefined,
            branchId,
            categoryId,
            description,
            documentNumber: documentNumber || undefined,
            paymentMethod,
            spentAt: new Date(spentAt).toISOString(),
            vendor: vendor || undefined,
          }).finally(() => setSaving(false));
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Label>
            Филиал
            <Select
              onChange={(event) => {
                setBranchId(event.target.value);
                setCategoryId('');
              }}
              required
              value={branchId}
            >
              <option value="">Выберите филиал</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </Select>
          </Label>
          <Label>
            Категория
            <Select
              onChange={(event) => setCategoryId(event.target.value)}
              required
              value={categoryId}
            >
              <option value="">Выберите категорию</option>
              {availableCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </Label>
          <Label>
            Сумма, ₽
            <Input
              min="0.01"
              onChange={(event) => setAmount(event.target.value)}
              required
              step="0.01"
              type="number"
              value={amount}
            />
          </Label>
          <Label>
            Дата и время
            <Input
              onChange={(event) => setSpentAt(event.target.value)}
              required
              type="datetime-local"
              value={spentAt}
            />
          </Label>
          <Label>
            Способ оплаты
            <Select
              onChange={(event) =>
                setPaymentMethod(event.target.value as ExpenseInput['paymentMethod'])
              }
              value={paymentMethod}
            >
              <option value="CASH">Наличные</option>
              <option value="CARD">Карта</option>
              <option value="TRANSFER">Перевод</option>
              <option value="OTHER">Другое</option>
            </Select>
          </Label>
          <Label>
            Поставщик
            <Input
              onChange={(event) => setVendor(event.target.value)}
              placeholder="Необязательно"
              value={vendor}
            />
          </Label>
          <Label>
            Номер документа
            <Input
              onChange={(event) => setDocumentNumber(event.target.value)}
              placeholder="Необязательно"
              value={documentNumber}
            />
          </Label>
          <Label>
            Путь к файлу
            <Input
              onChange={(event) => setAttachmentPath(event.target.value)}
              placeholder="Чек или документ"
              value={attachmentPath}
            />
          </Label>
        </div>
        <Label>
          Описание
          <Textarea
            onChange={(event) => setDescription(event.target.value)}
            required
            rows={3}
            value={description}
          />
        </Label>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} type="button" variant="secondary">
            Отмена
          </Button>
          <Button disabled={saving} type="submit">
            {saving ? 'Сохраняем…' : 'Сохранить черновик'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
