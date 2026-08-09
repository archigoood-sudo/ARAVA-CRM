import { Button, Card, EmptyState, Input, Label, PageHeader, Select } from '@arava/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderPlus, Plus } from 'lucide-react';
import { useState } from 'react';
import { getDesktopApi } from '../../lib/desktop-api';
import { getSessionToken } from '../../stores/auth-store';

export function ExpenseCategoriesPage() {
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [branchId, setBranchId] = useState('');
  const [error, setError] = useState<string>();
  const categories = useQuery({
    queryFn: () => getDesktopApi().expenseCategories.list(getSessionToken()),
    queryKey: ['expense-categories'],
  });
  const branches = useQuery({
    queryFn: () => getDesktopApi().branches.list(getSessionToken()),
    queryKey: ['branches'],
  });
  const create = async () => {
    try {
      await getDesktopApi().expenseCategories.create(getSessionToken(), {
        branchId: branchId || undefined,
        description: description || undefined,
        isActive: true,
        name,
      });
      setName('');
      setDescription('');
      await client.invalidateQueries({ queryKey: ['expense-categories'] });
    } catch {
      setError('Не удалось создать категорию. Проверьте права и заполнение формы.');
    }
  };
  return (
    <main className="mx-auto w-full max-w-[1300px] animate-fade-in p-9 pb-14">
      <PageHeader
        description="Общие и филиальные статьи затрат без удаления финансовой истории."
        title="Категории расходов"
      />
      <div className="grid grid-cols-[380px_1fr] gap-5">
        <Card className="h-fit p-5">
          <h2 className="text-lg font-semibold">Новая категория</h2>
          <div className="mt-5 space-y-4">
            <Label>
              Название
              <Input onChange={(event) => setName(event.target.value)} value={name} />
            </Label>
            <Label>
              Филиал
              <Select onChange={(event) => setBranchId(event.target.value)} value={branchId}>
                <option value="">Общая категория</option>
                {branches.data?.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </Select>
            </Label>
            <Label>
              Описание
              <Input onChange={(event) => setDescription(event.target.value)} value={description} />
            </Label>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button disabled={name.trim().length < 2} onClick={() => void create()}>
              <Plus className="size-4" />
              Создать категорию
            </Button>
          </div>
        </Card>
        <div>
          {!categories.data?.length ? (
            <EmptyState
              description="Создайте статьи затрат для удобной аналитики."
              icon={FolderPlus}
              title="Категорий пока нет"
            />
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {categories.data.map((category) => (
                <Card className="p-5" key={category.id}>
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold">{category.name}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {category.branchName ?? 'Все филиалы'}
                      </p>
                      {category.description ? (
                        <p className="mt-3 text-sm">{category.description}</p>
                      ) : null}
                    </div>
                    <Button
                      onClick={() =>
                        void getDesktopApi()
                          .expenseCategories.archive(getSessionToken(), category.id)
                          .then(() =>
                            client.invalidateQueries({ queryKey: ['expense-categories'] }),
                          )
                      }
                      size="small"
                      variant="ghost"
                    >
                      Архивировать
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
