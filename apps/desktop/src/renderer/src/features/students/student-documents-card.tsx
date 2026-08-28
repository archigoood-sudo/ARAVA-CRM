import {
  formatDate,
  type StudentContactSummary,
  type StudentDocumentAttachmentInput,
  type StudentDocumentInput,
  type StudentDocumentStatus,
  type StudentDocumentSummary,
  type StudentDocumentType,
} from '@arava/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  Input,
  Label,
  Select,
  Textarea,
} from '@arava/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, FileText, Paperclip, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';

import { getDesktopApi } from '../../lib/desktop-api';
import { getErrorMessage } from '../../lib/errors';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';

const TYPES: { label: string; value: StudentDocumentType }[] = [
  { label: 'Договор', value: 'CONTRACT' },
  { label: 'Персональные данные', value: 'PERSONAL_DATA_CONSENT' },
  { label: 'Фото и видео', value: 'MEDIA_CONSENT' },
];

const STATUS_OPTIONS: Record<
  StudentDocumentType,
  { label: string; value: StudentDocumentStatus }[]
> = {
  CONTRACT: [
    { label: 'Действует', value: 'ACTIVE' },
    { label: 'Завершён', value: 'COMPLETED' },
    { label: 'Аннулирован', value: 'CANCELLED' },
  ],
  MEDIA_CONSENT: [
    { label: 'Разрешено', value: 'ALLOWED' },
    { label: 'Не разрешено', value: 'NOT_ALLOWED' },
    { label: 'Отозвано', value: 'REVOKED' },
    { label: 'Не предоставлено', value: 'NOT_PROVIDED' },
  ],
  PERSONAL_DATA_CONSENT: [
    { label: 'Согласие получено', value: 'CONSENTED' },
    { label: 'Отозвано', value: 'REVOKED' },
    { label: 'Не предоставлено', value: 'NOT_PROVIDED' },
  ],
};

function today(): string {
  const now = new Date();
  return `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function statusLabel(type: StudentDocumentType, status: string): string {
  return STATUS_OPTIONS[type].find(({ value }) => value === status)?.label ?? status;
}

function currentText(type: StudentDocumentType, document?: StudentDocumentSummary): string {
  if (!document) {
    if (type === 'CONTRACT') return 'Договор не оформлен';
    return 'Не предоставлено';
  }
  const date = formatDate(`${document.documentDate}T12:00:00`, { dateStyle: 'medium' });
  return [
    document.contractNumber ? `№ ${document.contractNumber}` : undefined,
    statusLabel(type, document.status),
    date,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function StudentDocumentsCard({
  contacts,
  studentId,
}: {
  contacts: StudentContactSummary[];
  studentId: string;
}) {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const queryKey = ['student-documents', user?.id, studentId];
  const documents = useQuery({
    queryFn: () => getDesktopApi().studentDocuments.list(getSessionToken(), studentId),
    queryKey,
  });
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<'EXISTING' | 'GENERATED'>('EXISTING');
  const [documentType, setDocumentType] = useState<StudentDocumentType>('CONTRACT');
  const [documentDate, setDocumentDate] = useState(today());
  const [status, setStatus] = useState<StudentDocumentStatus>('ACTIVE');
  const [contractNumber, setContractNumber] = useState('');
  const [representativeContactId, setRepresentativeContactId] = useState('');
  const [note, setNote] = useState('');
  const [attachment, setAttachment] = useState<StudentDocumentAttachmentInput>();
  const [error, setError] = useState<string>();
  const current = useMemo(() => {
    const map = new Map<StudentDocumentType, StudentDocumentSummary>();
    for (const document of documents.data ?? []) {
      if (!map.has(document.documentType)) map.set(document.documentType, document);
    }
    return map;
  }, [documents.data]);

  const reset = (nextSource: 'EXISTING' | 'GENERATED', nextType: StudentDocumentType) => {
    setSource(nextSource);
    setDocumentType(nextType);
    setDocumentDate(today());
    setStatus(
      nextType === 'CONTRACT' ? 'ACTIVE' : nextType === 'MEDIA_CONSENT' ? 'ALLOWED' : 'CONSENTED',
    );
    setContractNumber('');
    setRepresentativeContactId('');
    setNote('');
    setAttachment(undefined);
    setError(undefined);
    setOpen(true);
  };
  const create = useMutation({
    mutationFn: (input: StudentDocumentInput) =>
      getDesktopApi().studentDocuments.create(getSessionToken(), studentId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
      setOpen(false);
    },
  });
  const changeStatus = useMutation({
    mutationFn: ({ id, nextStatus }: { id: string; nextStatus: StudentDocumentStatus }) =>
      getDesktopApi().studentDocuments.changeStatus(getSessionToken(), id, { status: nextStatus }),
    onError: (caught) =>
      setError(getErrorMessage(caught, 'Не удалось изменить состояние документа.')),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey }),
  });
  const removeAttachment = useMutation({
    mutationFn: (id: string) =>
      getDesktopApi().studentDocuments.removeAttachment(getSessionToken(), id),
    onError: (caught) => setError(getErrorMessage(caught, 'Не удалось удалить файл документа.')),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey }),
  });
  const openAttachment = async (id: string) => {
    try {
      setError(undefined);
      await getDesktopApi().studentDocuments.openAttachment(getSessionToken(), id);
    } catch (caught) {
      setError(getErrorMessage(caught, 'Файл документа недоступен.'));
    }
  };
  const selectAttachment = async () => {
    try {
      setAttachment(await getDesktopApi().studentDocuments.selectAttachment(getSessionToken()));
    } catch (caught) {
      setError(getErrorMessage(caught, 'Не удалось добавить файл.'));
    }
  };
  const submit = async () => {
    setError(undefined);
    try {
      await create.mutateAsync({
        ...(attachment ? { attachment } : {}),
        ...(contractNumber.trim() ? { contractNumber: contractNumber.trim() } : {}),
        documentDate,
        documentType,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(representativeContactId ? { representativeContactId } : {}),
        source,
        status,
      });
    } catch (caught) {
      setError(getErrorMessage(caught, 'Не удалось сохранить документ.'));
    }
  };

  return (
    <Card className="mb-5" data-testid="student-documents">
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle>Документы</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Договор и независимые согласия ученика
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={() => reset('GENERATED', 'CONTRACT')} size="small">
            <Plus className="size-4" /> Оформить новый
          </Button>
          <Button onClick={() => reset('EXISTING', 'CONTRACT')} size="small" variant="outline">
            Добавить существующий
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {documents.isError ? (
          <p className="text-sm text-red-600">Не удалось загрузить документы.</p>
        ) : (
          <div className="divide-y divide-border rounded-2xl border border-border">
            {TYPES.map((type) => {
              const document = current.get(type.value);
              return (
                <div className="flex flex-wrap items-center gap-3 px-4 py-3" key={type.value}>
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-[220px] flex-1">
                    <p className="text-sm font-semibold">{type.label}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {currentText(type.value, document)}
                    </p>
                  </div>
                  {document?.attachment ? (
                    <Button
                      onClick={() => void openAttachment(document.id)}
                      size="small"
                      variant="ghost"
                    >
                      <Paperclip className="size-4" /> Файл
                    </Button>
                  ) : null}
                  {document?.contractNumber ? (
                    <Button
                      onClick={() =>
                        void navigator.clipboard.writeText(document.contractNumber ?? '')
                      }
                      size="icon"
                      variant="ghost"
                      aria-label="Копировать номер договора"
                    >
                      <Copy className="size-4" />
                    </Button>
                  ) : null}
                  {!document && type.value !== 'CONTRACT' ? (
                    <Button
                      onClick={() => reset('EXISTING', type.value)}
                      size="small"
                      variant="ghost"
                    >
                      Добавить
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
        {(documents.data?.length ?? 0) > 0 ? (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-semibold">История документов</summary>
            <div className="mt-3 space-y-2">
              {documents.data?.map((document) => (
                <article className="rounded-xl border border-border p-3" key={document.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <b className="text-sm">
                      {TYPES.find(({ value }) => value === document.documentType)?.label}
                    </b>
                    <Badge>{statusLabel(document.documentType, document.status)}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(`${document.documentDate}T12:00:00`)}
                    </span>
                    {document.source === 'EXISTING' ? (
                      <Badge>Существующий</Badge>
                    ) : (
                      <Badge>CRM</Badge>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Select
                      aria-label={`Состояние ${document.id}`}
                      disabled={changeStatus.isPending}
                      onChange={(event) =>
                        changeStatus.mutate({
                          id: document.id,
                          nextStatus: event.target.value as StudentDocumentStatus,
                        })
                      }
                      value={document.status}
                    >
                      {STATUS_OPTIONS[document.documentType].map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                    {document.attachment ? (
                      <Button
                        disabled={removeAttachment.isPending}
                        onClick={() => removeAttachment.mutate(document.id)}
                        size="small"
                        variant="ghost"
                      >
                        Удалить файл
                      </Button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </details>
        ) : null}
        {error && !open ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      </CardContent>

      <Dialog
        closeLabel="Закрыть"
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpen(false)} variant="ghost">
              Отмена
            </Button>
            <Button disabled={create.isPending} onClick={() => void submit()}>
              {create.isPending ? 'Сохраняем…' : 'Сохранить'}
            </Button>
          </div>
        }
        onClose={() => setOpen(false)}
        open={open}
        title={source === 'GENERATED' ? 'Оформить новый договор' : 'Добавить существующий документ'}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {source === 'EXISTING' ? (
            <label className="space-y-2">
              <Label htmlFor="document-type">Тип документа</Label>
              <Select
                id="document-type"
                onChange={(event) => {
                  const next = event.target.value as StudentDocumentType;
                  setDocumentType(next);
                  setStatus(
                    next === 'CONTRACT'
                      ? 'ACTIVE'
                      : next === 'MEDIA_CONSENT'
                        ? 'ALLOWED'
                        : 'CONSENTED',
                  );
                }}
                value={documentType}
              >
                {TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </Select>
            </label>
          ) : null}
          <label className="space-y-2">
            <Label htmlFor="document-date">Дата</Label>
            <Input
              id="document-date"
              onChange={(event) => setDocumentDate(event.target.value)}
              type="date"
              value={documentDate}
            />
          </label>
          <label className="space-y-2">
            <Label htmlFor="document-status">Состояние</Label>
            <Select
              id="document-status"
              onChange={(event) => setStatus(event.target.value as StudentDocumentStatus)}
              value={status}
            >
              {STATUS_OPTIONS[documentType].map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </label>
          {documentType === 'CONTRACT' && source === 'EXISTING' ? (
            <label className="space-y-2">
              <Label htmlFor="contract-number">Номер договора</Label>
              <Input
                id="contract-number"
                onChange={(event) => setContractNumber(event.target.value)}
                value={contractNumber}
              />
            </label>
          ) : null}
          <label className="space-y-2">
            <Label htmlFor="document-representative">Подписант / представитель</Label>
            <Select
              id="document-representative"
              onChange={(event) => setRepresentativeContactId(event.target.value)}
              value={representativeContactId}
            >
              <option value="">Сам ученик / не указан</option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.fullName} · {contact.relationship}
                </option>
              ))}
            </Select>
          </label>
          <div className="space-y-2 sm:col-span-2">
            <Label>Файл (необязательно)</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => void selectAttachment()} size="small" variant="outline">
                <Paperclip className="size-4" /> Выбрать PDF/JPG/PNG
              </Button>
              {attachment ? (
                <span className="text-sm text-muted-foreground">{attachment.fileName}</span>
              ) : null}
            </div>
          </div>
          <label className="space-y-2 sm:col-span-2">
            <Label htmlFor="document-note">Примечание</Label>
            <Textarea
              id="document-note"
              maxLength={2000}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              value={note}
            />
          </label>
          {error ? <p className="text-sm text-red-600 sm:col-span-2">{error}</p> : null}
        </div>
      </Dialog>
    </Card>
  );
}
