import type { GroupRosterMember, TrialAppointmentSummary } from '@arava/shared';

export function activeTrialGuests(
  trials: TrialAppointmentSummary[],
  members: GroupRosterMember[],
): TrialAppointmentSummary[] {
  const memberIds = new Set(
    members.filter(({ segment }) => segment === 'CURRENT').map(({ studentId }) => studentId),
  );
  const seen = new Set<string>();
  return trials.filter((trial) => {
    if (!['SCHEDULED', 'TODAY'].includes(trial.state)) return false;
    if (trial.studentId && memberIds.has(trial.studentId)) return false;
    const subject = trial.studentId ?? trial.leadId ?? trial.id;
    if (seen.has(subject)) return false;
    seen.add(subject);
    return true;
  });
}
