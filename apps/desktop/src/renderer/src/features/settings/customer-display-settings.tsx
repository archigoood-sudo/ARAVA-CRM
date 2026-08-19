import type { CustomerDisplaySlideInput } from '@arava/shared';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  Input,
  Label,
  Select,
  Textarea,
} from '@arava/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  ImagePlus,
  Monitor,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { getDesktopApi } from '../../lib/desktop-api';
import { getSessionToken } from '../../stores/auth-store';

const queryKey = ['customer-display'];

function emptySlide(): CustomerDisplaySlideInput {
  return { isActive: true, title: '' };
}

export function CustomerDisplaySettings() {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryFn: () => getDesktopApi().customerDisplay.getStatus(getSessionToken()),
    queryKey,
    refetchInterval: 3_000,
  });
  const [slide, setSlide] = useState<CustomerDisplaySlideInput>();
  const [notice, setNotice] = useState<string>();
  const settings = status.data?.settings;

  const update = useMutation({
    mutationFn: (next: NonNullable<typeof settings>) =>
      getDesktopApi().customerDisplay.updateSettings(getSessionToken(), next),
    onSuccess: (value) => queryClient.setQueryData(queryKey, value),
  });
  const action = useMutation({
    mutationFn: async (kind: 'OPEN' | 'CLOSE' | 'PREVIEW' | 'PROMO') => {
      const api = getDesktopApi().customerDisplay;
      if (kind === 'OPEN') return api.open(getSessionToken());
      if (kind === 'CLOSE') return api.close(getSessionToken());
      if (kind === 'PREVIEW') return api.preview(getSessionToken());
      return api.returnToPromo(getSessionToken());
    },
    onSuccess: (value) => queryClient.setQueryData(queryKey, value),
  });
  const saveSlide = useMutation({
    mutationFn: (input: CustomerDisplaySlideInput) =>
      getDesktopApi().customerDisplay.saveSlide(getSessionToken(), input),
    onSuccess: (value) => {
      queryClient.setQueryData(queryKey, value);
      setSlide(undefined);
    },
  });
  const removeSlide = useMutation({
    mutationFn: (id: string) => getDesktopApi().customerDisplay.deleteSlide(getSessionToken(), id),
    onSuccess: (value) => queryClient.setQueryData(queryKey, value),
  });
  const moveSlide = useMutation({
    mutationFn: ({ direction, id }: { direction: 'UP' | 'DOWN'; id: string }) =>
      getDesktopApi().customerDisplay.moveSlide(getSessionToken(), id, direction),
    onSuccess: (value) => queryClient.setQueryData(queryKey, value),
  });

  useEffect(() => {
    const error = status.error ?? update.error ?? action.error ?? saveSlide.error;
    if (error instanceof Error) setNotice(error.message);
  }, [action.error, saveSlide.error, status.error, update.error]);

  const patchSettings = (patch: Partial<NonNullable<typeof settings>>) => {
    if (settings) update.mutate({ ...settings, ...patch });
  };

  return (
    <>
      <Card id="customer-display">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Экран клиента</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Рекламные материалы и краткая информация после сканирования карты.
              </p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${status.data?.windowOpen ? 'bg-emerald-100 text-emerald-800' : 'bg-muted text-muted-foreground'}`}
            >
              {status.data?.windowOpen ? 'Открыт' : 'Закрыт'}
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {notice ? (
            <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">{notice}</div>
          ) : null}
          {!status.data?.secondDisplayAvailable ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <strong>Второй экран не найден.</strong> Для настройки откройте безопасный
              предпросмотр в обычном окне.
            </div>
          ) : null}
          {settings?.displayId && !status.data?.selectedDisplayPresent ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              Выбранный монитор отключён. Экран клиента безопасно закрыт; подключите монитор и
              откройте его снова.
            </div>
          ) : null}
          {settings ? (
            <div className="grid gap-5 md:grid-cols-2">
              <label className="flex items-center gap-3 rounded-2xl border border-border p-4 text-sm font-medium">
                <Checkbox
                  checked={settings.enabled}
                  onChange={(event) => patchSettings({ enabled: event.target.checked })}
                />
                Включить экран клиента
              </label>
              <label className="flex items-center gap-3 rounded-2xl border border-border p-4 text-sm font-medium">
                <Checkbox
                  checked={settings.fullscreen}
                  onChange={(event) => patchSettings({ fullscreen: event.target.checked })}
                />
                Полноэкранный режим
              </label>
              <div className="space-y-2">
                <Label htmlFor="customer-monitor">Монитор</Label>
                <Select
                  id="customer-monitor"
                  onChange={(event) =>
                    patchSettings({ displayId: event.target.value || undefined })
                  }
                  value={settings.displayId ?? ''}
                >
                  <option value="">Не выбран</option>
                  {status.data?.displays.map((display) => (
                    <option disabled={display.isPrimary} key={display.id} value={display.id}>
                      {display.label}
                      {display.isPrimary ? ' (только предпросмотр)' : ''}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="customer-time">Показывать данные клиента, секунд</Label>
                <Input
                  id="customer-time"
                  max={300}
                  min={3}
                  onBlur={(event) => patchSettings({ customerSeconds: Number(event.target.value) })}
                  type="number"
                  defaultValue={settings.customerSeconds}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="slide-time">Длительность слайда, секунд</Label>
                <Input
                  id="slide-time"
                  max={300}
                  min={3}
                  onBlur={(event) => patchSettings({ slideSeconds: Number(event.target.value) })}
                  type="number"
                  defaultValue={settings.slideSeconds}
                />
              </div>
              <label className="flex items-center gap-3 rounded-2xl border border-border p-4 text-sm font-medium">
                <Checkbox
                  checked={settings.showLastName}
                  onChange={(event) => patchSettings({ showLastName: event.target.checked })}
                />
                Показывать первую букву фамилии
              </label>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => action.mutate('PREVIEW')} variant="outline">
              <Monitor className="size-4" />
              Предпросмотр
            </Button>
            <Button
              disabled={!settings?.enabled || !status.data?.selectedDisplayPresent}
              onClick={() => action.mutate('OPEN')}
            >
              <ExternalLink className="size-4" />
              Открыть экран
            </Button>
            <Button
              disabled={!status.data?.windowOpen}
              onClick={() => action.mutate('PROMO')}
              variant="outline"
            >
              Вернуть рекламу
            </Button>
            <Button
              disabled={!status.data?.windowOpen}
              onClick={() => action.mutate('CLOSE')}
              variant="outline"
            >
              Закрыть экран
            </Button>
          </div>

          <div className="border-t border-border pt-6">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h3 className="font-semibold">Рекламные материалы</h3>
                <p className="text-sm text-muted-foreground">
                  JPG, PNG или WEBP сохраняются внутри ARAVA.
                </p>
              </div>
              <Button onClick={() => setSlide(emptySlide())}>
                <Plus className="size-4" />
                Добавить слайд
              </Button>
            </div>
            <div className="space-y-3">
              {status.data?.slides.length ? (
                status.data.slides.map((item, index) => (
                  <div
                    className="flex items-center gap-4 rounded-2xl border border-border bg-background p-3"
                    key={item.id}
                  >
                    <div className="flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted">
                      {item.imageUrl ? (
                        <img alt="" className="h-full w-full object-cover" src={item.imageUrl} />
                      ) : (
                        <ImagePlus className="size-5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{item.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.isActive ? 'Показывается' : 'Выключен'} · Позиция {index + 1}
                      </p>
                    </div>
                    <Button
                      aria-label="Выше"
                      disabled={index === 0}
                      onClick={() => moveSlide.mutate({ direction: 'UP', id: item.id })}
                      size="icon"
                      variant="ghost"
                    >
                      <ArrowUp className="size-4" />
                    </Button>
                    <Button
                      aria-label="Ниже"
                      disabled={index === status.data.slides.length - 1}
                      onClick={() => moveSlide.mutate({ direction: 'DOWN', id: item.id })}
                      size="icon"
                      variant="ghost"
                    >
                      <ArrowDown className="size-4" />
                    </Button>
                    <Button
                      aria-label="Изменить"
                      onClick={() => setSlide(item)}
                      size="icon"
                      variant="ghost"
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      aria-label="Удалить"
                      onClick={() => {
                        if (window.confirm('Удалить этот слайд и его изображение?'))
                          removeSlide.mutate(item.id);
                      }}
                      size="icon"
                      variant="ghost"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  Слайдов пока нет. Экран покажет фирменную заставку ARAVA.
                </div>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Изображения рекламных слайдов и фото публикаций включаются в резервные копии вместе с
            базой данных.
          </p>
        </CardContent>
      </Card>

      <Dialog
        closeLabel="Закрыть"
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setSlide(undefined)} variant="outline">
              Отмена
            </Button>
            <Button
              disabled={!slide?.title.trim() || saveSlide.isPending}
              onClick={() => slide && saveSlide.mutate(slide)}
            >
              Сохранить
            </Button>
          </div>
        }
        onClose={() => setSlide(undefined)}
        open={Boolean(slide)}
        title={slide?.id ? 'Изменить слайд' : 'Добавить слайд'}
      >
        {slide ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="slide-title">Название</Label>
              <Input
                id="slide-title"
                onChange={(event) => setSlide({ ...slide, title: event.target.value })}
                value={slide.title}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="slide-text">Короткий текст</Label>
              <Textarea
                id="slide-text"
                onChange={(event) => setSlide({ ...slide, text: event.target.value })}
                value={slide.text ?? ''}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="slide-duration">Своя длительность, секунд</Label>
              <Input
                id="slide-duration"
                min={3}
                onChange={(event) =>
                  setSlide({
                    ...slide,
                    displaySeconds: event.target.value ? Number(event.target.value) : undefined,
                  })
                }
                type="number"
                value={slide.displaySeconds ?? ''}
              />
            </div>
            <label className="flex items-center gap-3 text-sm">
              <Checkbox
                checked={slide.isActive}
                onChange={(event) => setSlide({ ...slide, isActive: event.target.checked })}
              />
              Показывать слайд
            </label>
            <div className="flex items-center gap-3">
              <Button
                onClick={async () => {
                  const selected =
                    await getDesktopApi().customerDisplay.selectImage(getSessionToken());
                  if (selected) setSlide({ ...slide, mediaId: selected.mediaId });
                }}
                variant="outline"
              >
                <ImagePlus className="size-4" />
                Выбрать изображение
              </Button>
              {slide.mediaId ? (
                <span className="text-xs text-muted-foreground">Изображение выбрано</span>
              ) : null}
            </div>
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
