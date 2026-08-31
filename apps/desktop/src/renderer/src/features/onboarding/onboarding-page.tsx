import {
  formatDate,
  type LeadDetail,
  type StudentInput,
  type StudentProfileOverview,
} from '@arava/shared';
import { Button, Card, CardContent, EmptyState, ErrorState, LoadingState, Select } from '@arava/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  CreditCard,
  FileText,
  MessageCircle,
  RefreshCw,
  UserRound,
  UsersRound,
  WalletCards,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';

import { getDesktopApi } from '../../lib/desktop-api';
import { getErrorMessage } from '../../lib/errors';
import {
  invalidateStudentIdentityCaches,
  invalidateTrialCaches,
} from '../../lib/operational-cache';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';
import { StudentCard } from '../cards/student-card';
import { studentPrefill } from '../leads/lead-model';
import { StudentFinance } from '../subscriptions/student-finance';
import { StudentDialog } from '../students/student-dialog';
import { StudentDocumentsCard } from '../students/student-documents-card';
import { studentChatLink } from '../students/student-communication-model';
import {
  ONBOARDING_STEPS,
  canManageOnboarding,
  createOnboardingDraft,
  hasCompletedOnboardingSale,
  hasOnboardingMembership,
  nextOnboardingStep,
  onboardingStorageKey,
  parseOnboardingDraft,
  type OnboardingDraft,
  type OnboardingStep,
} from './onboarding-model';

const stepLabels: Record<OnboardingStep, string> = {
  CARD: 'Карта',
  CLIENT: 'Клиент',
  DOCUMENTS: 'Документы',
  GROUP: 'Группа',
  PAYMENT: 'Оплата',
};

function today(): string {
  const value = new Date();
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 10);
}

export function OnboardingPage() {
  const user = useAuthStore((state) => state.user);
  const [searchParameters] = useSearchParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const routeLeadId = searchParameters.get('leadId') ?? undefined;
  const routeStudentId = searchParameters.get('studentId') ?? undefined;
  const storageKey = onboardingStorageKey(user?.id ?? 'anonymous');
  const [draft, setDraft] = useState<OnboardingDraft | null>(() => {
    if (!user) return null;
    const restored = parseOnboardingDraft(localStorage.getItem(storageKey), user.id);
    if (
      restored &&
      (!routeLeadId || restored.leadId === routeLeadId) &&
      (!routeStudentId || restored.studentId === routeStudentId)
    )
      return restored;
    return createOnboardingDraft({
      actorId: user.id,
      ...(routeLeadId ? { leadId: routeLeadId } : {}),
      ...(routeStudentId ? { studentId: routeStudentId } : {}),
    });
  });
  const [studentDialogOpen, setStudentDialogOpen] = useState(false);
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [financeRequested, setFinanceRequested] = useState(false);
  const [cardRequested, setCardRequested] = useState(false);
  const [groupSaving, setGroupSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [finished, setFinished] = useState(false);
  const accessKey = `${user?.id ?? ''}:${user?.role ?? ''}:${[...(user?.branchIds ?? [])].sort().join(',')}`;

  useEffect(() => {
    if (draft && !finished) localStorage.setItem(storageKey, JSON.stringify(draft));
  }, [draft, finished, storageKey]);

  const lead = useQuery({
    enabled: Boolean(draft?.leadId && user?.role !== 'COACH'),
    queryFn: () => getDesktopApi().leads.get(getSessionToken(), draft?.leadId ?? ''),
    queryKey: queryKeys.lead(draft?.leadId ?? '', accessKey),
    retry: false,
  });
  const profile = useQuery({
    enabled: Boolean(draft?.studentId && user?.role !== 'COACH'),
    queryFn: () => getDesktopApi().students.getProfile(getSessionToken(), draft?.studentId ?? ''),
    queryKey: ['student-profile', user?.id, draft?.studentId],
    retry: false,
  });
  const branches = useQuery({
    enabled: user?.role === 'OWNER' || user?.role === 'ADMIN',
    queryFn: () => getDesktopApi().branches.list(getSessionToken()),
    queryKey: queryKeys.branches(),
  });
  const eligibleGroups = useQuery({
    enabled: Boolean(draft?.studentId),
    queryFn: () =>
      getDesktopApi().groups.listEligibleGroups(getSessionToken(), draft?.studentId ?? ''),
    queryKey: ['groups', 'eligible-for-student', draft?.studentId],
  });
  const trials = useQuery({
    enabled: Boolean(draft?.leadId),
    queryFn: () => getDesktopApi().trials.list(getSessionToken(), { leadId: draft?.leadId }),
    queryKey: queryKeys.trials(accessKey, { leadId: draft?.leadId }),
    retry: false,
  });
  const finance = useQuery({
    enabled: Boolean(draft?.studentId),
    queryFn: () =>
      getDesktopApi().subscriptions.listStudent(getSessionToken(), draft?.studentId ?? ''),
    queryKey: queryKeys.studentFinance(draft?.studentId ?? ''),
  });
  const card = useQuery({
    enabled: Boolean(draft?.studentId),
    queryFn: () => getDesktopApi().cards.studentCurrent(getSessionToken(), draft?.studentId ?? ''),
    queryKey: ['cards', 'student-current', draft?.studentId],
  });
  const communication = useQuery({
    enabled: Boolean(draft?.studentId),
    queryFn: () => getDesktopApi().chats.studentSummary(getSessionToken(), draft?.studentId ?? ''),
    queryKey: queryKeys.studentCommunication(accessKey, draft?.studentId ?? ''),
    retry: false,
  });

  useEffect(() => {
    const convertedStudentId = lead.data?.convertedStudentCrmId;
    if (!convertedStudentId || draft?.studentId === convertedStudentId) return;
    setDraft((current) =>
      current ? { ...current, step: 'GROUP', studentId: convertedStudentId } : current,
    );
  }, [draft?.studentId, lead.data?.convertedStudentCrmId]);

  useEffect(() => {
    if (draft?.targetGroupId || !draft) return;
    const trialGroupId = trials.data?.find(({ state }) => state !== 'CANCELLED')?.groupId;
    const targetGroupId = trialGroupId ?? lead.data?.crmGroupId;
    if (targetGroupId) setDraft((current) => (current ? { ...current, targetGroupId } : current));
  }, [draft, draft?.targetGroupId, lead.data?.crmGroupId, trials.data]);

  if (!canManageOnboarding(user?.role)) return <Navigate replace to="/dashboard" />;
  if (!draft?.leadId && !draft?.studentId)
    return (
      <main className="mx-auto w-full max-w-3xl p-7">
        <EmptyState
          description="Начните оформление из заявки или профиля существующего ученика."
          icon={UserRound}
          title="Выберите клиента"
        />
        <div className="mt-4 flex justify-center gap-3">
          <Link className="text-sm font-semibold underline" to="/leads">
            Открыть заявки
          </Link>
          <Link className="text-sm font-semibold underline" to="/students">
            Открыть учеников
          </Link>
        </div>
      </main>
    );

  const updateDraft = (patch: Partial<OnboardingDraft>) =>
    setDraft((current) => {
      if (!current) return current;
      const next = { ...current, ...patch };
      localStorage.setItem(storageKey, JSON.stringify(next));
      return next;
    });
  const currentProfile = profile.data;
  const student = currentProfile?.student;
  const hasMembership = hasOnboardingMembership(currentProfile, draft.targetGroupId);
  const hasPaidSubscription = hasCompletedOnboardingSale(finance.data);
  const targetGroup =
    currentProfile?.groups.find(({ groupId }) => groupId === draft.targetGroupId) ??
    eligibleGroups.data?.find(({ id }) => id === draft.targetGroupId);
  const targetGroupName = targetGroup
    ? 'groupName' in targetGroup
      ? targetGroup.groupName
      : targetGroup.name
    : undefined;
  const initialStudent = lead.data ? studentPrefill(lead.data, branches.data ?? []) : undefined;
  const stepIndex = ONBOARDING_STEPS.indexOf(draft.step);

  const createStudent = async (input: StudentInput) => {
    if (!lead.data) return;
    setError(undefined);
    try {
      const result = await getDesktopApi().leads.createStudent(getSessionToken(), lead.data.id, {
        addToGroup: false,
        allowDuplicate,
        student: input,
      });
      updateDraft({ step: 'GROUP', studentId: result.student.id });
      setStudentDialogOpen(false);
      await Promise.all([
        invalidateStudentIdentityCaches(client, result.student.id),
        invalidateTrialCaches(client),
        client.invalidateQueries({ queryKey: queryKeys.lead(lead.data.id, accessKey) }),
      ]);
    } catch (caught) {
      setError(getErrorMessage(caught, 'Не удалось создать клиента из заявки.'));
    }
  };

  const linkStudent = async (studentId: string) => {
    if (!lead.data) return;
    setError(undefined);
    try {
      await getDesktopApi().leads.convert(getSessionToken(), lead.data.id, studentId);
      updateDraft({ step: 'GROUP', studentId });
      await Promise.all([
        invalidateStudentIdentityCaches(client, studentId),
        invalidateTrialCaches(client),
        client.invalidateQueries({ queryKey: queryKeys.lead(lead.data.id, accessKey) }),
      ]);
    } catch (caught) {
      setError(getErrorMessage(caught, 'Не удалось связать заявку с клиентом.'));
    }
  };

  const addMembership = async () => {
    if (!draft.studentId || !draft.targetGroupId || hasMembership || groupSaving) return;
    setError(undefined);
    setGroupSaving(true);
    try {
      await getDesktopApi().groups.addEnrollment(getSessionToken(), draft.targetGroupId, {
        joinedAt: today(),
        overrideCapacity: false,
        status: 'ACTIVE',
        studentId: draft.studentId,
      });
      await invalidateStudentIdentityCaches(client, draft.studentId);
      updateDraft({ step: 'DOCUMENTS' });
    } catch (caught) {
      setError(getErrorMessage(caught, 'Не удалось добавить клиента в группу.'));
    } finally {
      setGroupSaving(false);
    }
  };

  const advance = () => {
    const next = nextOnboardingStep(draft.step, {
      hasMembership,
      hasPaidSubscription,
      hasStudent: Boolean(student),
    });
    if (next === 'DONE') {
      setFinished(true);
      localStorage.removeItem(storageKey);
      return;
    }
    updateDraft({
      ...(draft.step === 'DOCUMENTS' ? { documentsReviewed: true } : {}),
      step: next,
    });
  };

  if (finished && student)
    return (
      <main className="mx-auto flex h-full w-full max-w-3xl items-center justify-center p-7">
        <Card className="w-full overflow-hidden text-center" data-testid="onboarding-complete">
          <CardContent className="p-10">
            <span className="mx-auto flex size-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <CheckCircle2 className="size-8" />
            </span>
            <h1 className="mt-5 text-3xl font-semibold">Клиент оформлен</h1>
            <p className="mt-2 text-muted-foreground">
              {student.lastName} {student.firstName} добавлен в группу, оплата подтверждена.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link
                className="inline-flex h-11 items-center rounded-xl bg-accent px-5 text-sm font-semibold text-neutral-950"
                to={`/students/${student.id}`}
              >
                Открыть профиль
              </Link>
              {communication.data?.state === 'AVAILABLE' && communication.data.conversationId ? (
                <Link
                  className="inline-flex h-11 items-center gap-2 rounded-xl bg-sidebar px-5 text-sm font-semibold text-white"
                  to={studentChatLink(student.id, communication.data.conversationId)}
                >
                  <MessageCircle className="size-4" /> Написать
                </Link>
              ) : (
                <Button disabled title="Личный чат ещё не связан" variant="outline">
                  <MessageCircle className="size-4" /> Написать
                </Button>
              )}
              <Button onClick={() => navigate('/leads')} variant="outline">
                Закрыть
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    );

  if ((draft.studentId && profile.isLoading) || (draft.leadId && lead.isLoading))
    return <LoadingState label="Восстанавливаем оформление клиента…" />;
  if (profile.isError || lead.isError)
    return (
      <ErrorState
        message="Не удалось восстановить оформление. Проверьте доступ к клиенту или заявке."
        onRetry={() => void Promise.all([profile.refetch(), lead.refetch()])}
        retryLabel="Повторить"
        title="Оформление недоступно"
      />
    );

  return (
    <main
      className="mx-auto flex h-full w-full max-w-[1320px] flex-col overflow-hidden p-5 md:p-7"
      data-testid="client-onboarding"
    >
      <div className="flex shrink-0 items-start justify-between gap-4">
        <div>
          <Link
            className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
            to={
              draft.leadId ? `/leads?leadId=${draft.leadId}` : `/students/${draft.studentId ?? ''}`
            }
          >
            <ArrowLeft className="size-4" /> Назад
          </Link>
          <p className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            ARAVA · ОФОРМЛЕНИЕ
          </p>
          <h1 className="mt-1 text-3xl font-semibold">Новый клиент</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Все этапы используют существующие данные и операции CRM.
          </p>
        </div>
        <Button
          onClick={() =>
            void Promise.all([lead.refetch(), profile.refetch(), finance.refetch(), card.refetch()])
          }
          size="small"
          variant="outline"
        >
          <RefreshCw className="size-4" /> Обновить
        </Button>
      </div>

      <ol className="mt-5 grid shrink-0 grid-cols-5 gap-2" aria-label="Этапы оформления">
        {ONBOARDING_STEPS.map((step, index) => {
          const complete = index < stepIndex || (step === 'PAYMENT' && hasPaidSubscription);
          return (
            <li key={step}>
              <button
                className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm ${step === draft.step ? 'border-accent bg-accent/10 font-semibold' : 'border-border bg-surface'} ${index > stepIndex + 1 ? 'opacity-60' : ''}`}
                disabled={index > stepIndex || (index > 0 && !student)}
                onClick={() => updateDraft({ step })}
                type="button"
              >
                <span
                  className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs ${complete ? 'bg-emerald-600 text-white' : 'bg-muted'}`}
                >
                  {complete ? <Check className="size-3.5" /> : index + 1}
                </span>
                <span className="truncate">{stepLabels[step]}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto rounded-2xl border border-border bg-background p-5">
        {error ? (
          <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>
        ) : null}
        {draft.step === 'CLIENT' ? (
          <ClientStep
            allowDuplicate={allowDuplicate}
            lead={lead.data}
            onAllowDuplicate={() => setAllowDuplicate(true)}
            onCreate={() => setStudentDialogOpen(true)}
            onLink={(id) => void linkStudent(id)}
            student={student}
          />
        ) : null}
        {draft.step === 'GROUP' && student ? (
          <section data-testid="onboarding-group-step">
            <StepTitle icon={UsersRound} title="Добавьте клиента в группу" />
            {hasMembership ? (
              <SuccessLine>{targetGroupName ?? 'Группа'} уже назначена</SuccessLine>
            ) : (
              <div className="mt-5 max-w-xl space-y-3">
                <Select
                  aria-label="Группа оформления"
                  onChange={(event) =>
                    updateDraft({ targetGroupId: event.target.value || undefined })
                  }
                  value={draft.targetGroupId ?? ''}
                >
                  <option value="">Выберите группу</option>
                  {(eligibleGroups.data ?? []).map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name} · свободно {group.availablePlaces}
                    </option>
                  ))}
                </Select>
                {draft.targetGroupId &&
                !(eligibleGroups.data ?? []).some(({ id }) => id === draft.targetGroupId) ? (
                  <p className="text-sm text-amber-700">
                    Группа из заявки или пробного недоступна. Выберите актуальную группу вручную.
                  </p>
                ) : null}
                <Button
                  disabled={!draft.targetGroupId || groupSaving}
                  onClick={() => void addMembership()}
                >
                  {groupSaving ? 'Добавляем…' : 'Добавить в группу'}
                </Button>
              </div>
            )}
            {hasMembership ? <StepFooter onNext={advance} /> : null}
          </section>
        ) : null}
        {draft.step === 'DOCUMENTS' && student ? (
          <section data-testid="onboarding-documents-step">
            <StepTitle icon={FileText} title="Документы" />
            <p className="mt-2 text-sm text-muted-foreground">
              Сформируйте или приложите документы сейчас. Этот этап не блокирует оплату, абонемент и
              посещения.
            </p>
            <StudentDocumentsCard contacts={student.contacts} studentId={student.id} />
            <StepFooter label="Перейти к оплате" onNext={advance} />
          </section>
        ) : null}
        {draft.step === 'PAYMENT' && student ? (
          <section data-testid="onboarding-payment-step">
            <StepTitle icon={WalletCards} title="Оплата и абонемент" />
            <p className="mt-2 text-sm text-muted-foreground">
              Продажа использует единый payment flow. Абонемент появится только после полной
              успешной оплаты.
            </p>
            {hasPaidSubscription ? (
              <SuccessLine>Полная оплата подтверждена, абонемент создан</SuccessLine>
            ) : null}
            {currentProfile.pendingSale ? (
              <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
                Оплата ожидает подтверждения. Проверьте существующую операцию — новую продажу
                создавать не нужно.
              </p>
            ) : null}
            {!hasPaidSubscription ? (
              <div className="mt-4">
                <Button
                  disabled={Boolean(currentProfile.pendingSale)}
                  onClick={() => setFinanceRequested(true)}
                >
                  Оформить оплату и абонемент
                </Button>
              </div>
            ) : null}
            <div className="mt-4">
              <StudentFinance
                branches={branches.data ?? []}
                initialFinance={finance.data}
                onRequestedActionHandled={() => setFinanceRequested(false)}
                requestedAction={financeRequested ? 'subscription' : undefined}
                student={student}
              />
            </div>
            {hasPaidSubscription ? <StepFooter onNext={advance} /> : null}
          </section>
        ) : null}
        {draft.step === 'CARD' && student ? (
          <section data-testid="onboarding-card-step">
            <StepTitle icon={CreditCard} title="Карта клиента" />
            <p className="mt-2 text-sm text-muted-foreground">
              Карта необязательна. Её можно привязать сейчас или позже в профиле.
            </p>
            <StudentCard
              assignRequested={cardRequested}
              onAssignRequestedHandled={() => setCardRequested(false)}
              studentId={student.id}
            />
            <div className="mt-5 flex flex-wrap justify-end gap-3 border-t border-border pt-4">
              {!card.data ? (
                <Button onClick={() => setCardRequested(true)} variant="outline">
                  Привязать карту
                </Button>
              ) : null}
              <Button
                onClick={() => {
                  updateDraft({ cardSkipped: !card.data });
                  advance();
                }}
              >
                {card.data ? 'Завершить оформление' : 'Пропустить и завершить'}
              </Button>
            </div>
          </section>
        ) : null}
      </div>

      <StudentDialog
        branches={branches.data ?? []}
        error={error}
        initialValues={initialStudent}
        onClose={() => setStudentDialogOpen(false)}
        onSubmit={createStudent}
        open={studentDialogOpen}
        student={null}
      />
    </main>
  );
}

function ClientStep({
  allowDuplicate,
  lead,
  onAllowDuplicate,
  onCreate,
  onLink,
  student,
}: {
  allowDuplicate: boolean;
  lead?: LeadDetail | undefined;
  onAllowDuplicate: () => void;
  onCreate: () => void;
  onLink: (studentId: string) => void;
  student?: StudentProfileOverview['student'] | undefined;
}) {
  return (
    <section data-testid="onboarding-client-step">
      <StepTitle icon={UserRound} title="Клиент" />
      {student ? (
        <>
          <SuccessLine>
            {student.lastName} {student.firstName} уже связан с оформлением
          </SuccessLine>
        </>
      ) : lead ? (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Info label="Заявка" value={lead.childName} />
            <Info label="Телефон" value={lead.phone} />
            <Info label="Создана" value={formatDate(lead.createdAt, { dateStyle: 'medium' })} />
          </div>
          {lead.existingStudentCandidates.length > 0 && !allowDuplicate ? (
            <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <b>Возможно, клиент уже есть в CRM</b>
              <p className="mt-1">
                Проверьте совпадения по телефону. Автоматического объединения нет.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {lead.existingStudentCandidates.map((candidate) => (
                  <Button
                    key={candidate.crmStudentId}
                    onClick={() => onLink(candidate.crmStudentId)}
                    size="small"
                    variant="outline"
                  >
                    Связать: {candidate.displayName}
                  </Button>
                ))}
                <Button onClick={onAllowDuplicate} size="small" variant="ghost">
                  Создать другого клиента
                </Button>
              </div>
            </div>
          ) : (
            <Button className="mt-5" onClick={onCreate}>
              Создать клиента из заявки
            </Button>
          )}
        </>
      ) : null}
    </section>
  );
}

function StepTitle({ icon: Icon, title }: { icon: typeof UserRound; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-10 items-center justify-center rounded-xl bg-muted">
        <Icon className="size-5" />
      </span>
      <h2 className="text-xl font-semibold">{title}</h2>
    </div>
  );
}

function SuccessLine({ children }: { children: ReactNode }) {
  return (
    <p className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
      <CheckCircle2 className="size-4" /> {children}
    </p>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  );
}

function StepFooter({ label = 'Продолжить', onNext }: { label?: string; onNext: () => void }) {
  return (
    <div className="mt-5 flex justify-end border-t border-border pt-4">
      <Button onClick={onNext}>{label}</Button>
    </div>
  );
}
