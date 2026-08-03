import type { StudentContactInput, StudentContactSummary, StudentInput } from '@arava/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  LoadingState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@arava/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Crown, Mail, Pencil, Phone, Plus, Trash2, UserRound } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { getDesktopApi } from '../../lib/desktop-api';
import { getErrorMessage } from '../../lib/errors';
import { queryKeys } from '../../lib/query-keys';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';
import { ContactDialog } from './contact-dialog';
import { StudentDialog } from './student-dialog';

export function StudentProfilePage() {
  const { studentId = '' } = useParams();
  const user = useAuthStore((state) => state.user);
  const canManage =
    user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'BRANCH_MANAGER';
  const queryClient = useQueryClient();
  const [studentDialog, setStudentDialog] = useState(false);
  const [contactDialog, setContactDialog] = useState(false);
  const [editingContact, setEditingContact] = useState<StudentContactSummary | null>(null);
  const [error, setError] = useState<string>();
  const student = useQuery({
    queryFn: () => getDesktopApi().students.get(getSessionToken(), studentId),
    queryKey: queryKeys.student(studentId),
    enabled: Boolean(studentId),
  });
  const branches = useQuery({
    queryFn: () => getDesktopApi().branches.list(getSessionToken()),
    queryKey: queryKeys.branches(),
  });
  const updateStudent = useMutation({
    mutationFn: (input: StudentInput) =>
      getDesktopApi().students.update(getSessionToken(), studentId, input),
  });
  const createContact = useMutation({
    mutationFn: (input: StudentContactInput) =>
      getDesktopApi().contacts.create(getSessionToken(), studentId, input),
  });
  const updateContact = useMutation({
    mutationFn: ({ id, input }: { id: string; input: StudentContactInput }) =>
      getDesktopApi().contacts.update(getSessionToken(), id, input),
  });
  const removeContact = useMutation({
    mutationFn: (id: string) => getDesktopApi().contacts.remove(getSessionToken(), id),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.student(studentId) });
  const saveStudent = async (input: StudentInput) => {
    setError(undefined);
    try {
      await updateStudent.mutateAsync(input);
      await refresh();
      setStudentDialog(false);
    } catch (caught) {
      setError(getErrorMessage(caught, 'Student could not be updated.'));
    }
  };
  const saveContact = async (input: StudentContactInput) => {
    setError(undefined);
    try {
      if (editingContact) await updateContact.mutateAsync({ id: editingContact.id, input });
      else await createContact.mutateAsync(input);
      await refresh();
      setContactDialog(false);
    } catch (caught) {
      setError(getErrorMessage(caught, 'Contact could not be saved.'));
    }
  };
  const remove = async (id: string) => {
    await removeContact.mutateAsync(id);
    await refresh();
  };

  if (student.isLoading) return <LoadingState label="Loading student profile…" />;
  if (student.isError || !student.data)
    return (
      <ErrorState
        message="The student profile could not be loaded."
        onRetry={() => void student.refetch()}
      />
    );
  const detail = student.data;
  const fullName = `${detail.lastName} ${detail.firstName}${detail.middleName ? ` ${detail.middleName}` : ''}`;
  return (
    <main className="mx-auto w-full max-w-[1300px] p-9 pb-14">
      <Link
        className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground transition hover:text-foreground"
        to="/students"
      >
        <ArrowLeft className="size-4" />
        Back to students
      </Link>
      <div className="mb-8 flex items-end justify-between">
        <div className="flex items-center gap-4">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-neutral-900 text-xl font-semibold text-white dark:bg-accent dark:text-neutral-950">
            {detail.firstName.charAt(0)}
            {detail.lastName.charAt(0)}
          </span>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-4xl font-semibold tracking-[-0.045em]">{fullName}</h2>
              <Badge>{detail.status}</Badge>
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">{detail.branchName}</p>
          </div>
        </div>
        {canManage ? (
          <Button
            onClick={() => {
              setError(undefined);
              setStudentDialog(true);
            }}
            variant="outline"
          >
            <Pencil className="size-4" />
            Edit student
          </Button>
        ) : null}
      </div>
      <div className="grid grid-cols-[320px_minmax(0,1fr)] gap-5">
        <Card>
          <CardHeader>
            <CardTitle>Profile details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Detail label="Phone" value={detail.phone ?? 'Not provided'} />
            <Detail label="Email" value={detail.email ?? 'Not provided'} />
            <Detail label="Birth date" value={detail.birthDate ?? 'Not provided'} />
            <Detail label="Gender" value={detail.gender ?? 'Not specified'} />
            <Detail label="Notes" value={detail.notes ?? 'No notes'} />
          </CardContent>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Parents and contacts</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Family and emergency contact information.
              </p>
            </div>
            {canManage ? (
              <Button
                onClick={() => {
                  setEditingContact(null);
                  setError(undefined);
                  setContactDialog(true);
                }}
                size="small"
              >
                <Plus className="size-4" />
                Add contact
              </Button>
            ) : null}
          </CardHeader>
          {detail.contacts.length === 0 ? (
            <EmptyState
              action={
                canManage ? (
                  <Button onClick={() => setContactDialog(true)}>Add first contact</Button>
                ) : undefined
              }
              description="Add a parent, guardian, or emergency contact for this student."
              icon={UserRound}
              title="No contacts yet"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contact</TableHead>
                  <TableHead>Relationship</TableHead>
                  <TableHead>Reach them</TableHead>
                  {canManage ? <TableHead className="text-right">Actions</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.contacts.map((contact) => (
                  <TableRow key={contact.id}>
                    <TableCell>
                      <p className="flex items-center gap-2 font-semibold">
                        {contact.fullName}
                        {contact.isPrimary ? <Crown className="size-3.5 text-amber-500" /> : null}
                      </p>
                      {contact.isPrimary ? (
                        <p className="mt-1 text-xs text-muted-foreground">Primary contact</p>
                      ) : null}
                    </TableCell>
                    <TableCell>{contact.relationship}</TableCell>
                    <TableCell>
                      <p className="flex items-center gap-1.5">
                        <Phone className="size-3.5 text-muted-foreground" />
                        {contact.phone}
                      </p>
                      {contact.email ? (
                        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Mail className="size-3" />
                          {contact.email}
                        </p>
                      ) : null}
                    </TableCell>
                    {canManage ? (
                      <TableCell>
                        <div className="flex justify-end">
                          <Button
                            aria-label={`Edit ${contact.fullName}`}
                            onClick={() => {
                              setEditingContact(contact);
                              setError(undefined);
                              setContactDialog(true);
                            }}
                            size="icon"
                            variant="ghost"
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            aria-label={`Remove ${contact.fullName}`}
                            disabled={removeContact.isPending}
                            onClick={() => void remove(contact.id)}
                            size="icon"
                            variant="ghost"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
      <StudentDialog
        branches={branches.data ?? []}
        error={error}
        onClose={() => setStudentDialog(false)}
        onSubmit={saveStudent}
        open={studentDialog}
        student={detail}
      />
      <ContactDialog
        contact={editingContact}
        error={error}
        onClose={() => setContactDialog(false)}
        onSubmit={saveContact}
        open={contactDialog}
      />
    </main>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-border pb-4 last:border-0 last:pb-0">
      <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1.5 text-sm leading-6">{value}</dd>
    </div>
  );
}
