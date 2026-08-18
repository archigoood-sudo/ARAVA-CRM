import type {
  CustomerDisplaySettings,
  CustomerDisplaySlide,
  CustomerDisplaySlideInput,
  CustomerDisplayStudent,
} from '@arava/shared';

import { FinanceService } from './finance-service';
import type { DatabaseClient } from './index';
import { DomainError } from './security';
import type { ApplicationService } from './services';

const SETTINGS_KEY = 'customerDisplay.settings';
const SLIDES_KEY = 'customerDisplay.slides';
const ACTIVE_ENROLLMENTS = ['ACTIVE', 'TRIAL', 'FROZEN'] as const;

export const CUSTOMER_DISPLAY_DEFAULTS: CustomerDisplaySettings = {
  customerSeconds: 15,
  enabled: false,
  fullscreen: true,
  showLastName: false,
  slideSeconds: 8,
};

function parseSettings(value?: string | null): CustomerDisplaySettings {
  try {
    const parsed = JSON.parse(value ?? '{}') as Partial<CustomerDisplaySettings>;
    const customerSeconds = parsed.customerSeconds;
    const slideSeconds = parsed.slideSeconds;
    return {
      customerSeconds:
        typeof customerSeconds === 'number' &&
        Number.isInteger(customerSeconds) &&
        customerSeconds >= 3
          ? customerSeconds
          : 15,
      displayId: typeof parsed.displayId === 'string' ? parsed.displayId : undefined,
      enabled: parsed.enabled === true,
      fullscreen: parsed.fullscreen !== false,
      showLastName: parsed.showLastName === true,
      slideSeconds:
        typeof slideSeconds === 'number' && Number.isInteger(slideSeconds) && slideSeconds >= 3
          ? slideSeconds
          : 8,
    };
  } catch {
    return { ...CUSTOMER_DISPLAY_DEFAULTS };
  }
}

function parseSlides(value?: string | null): CustomerDisplaySlide[] {
  try {
    const parsed = JSON.parse(value ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (slide): slide is CustomerDisplaySlide =>
          typeof slide === 'object' &&
          slide !== null &&
          typeof (slide as CustomerDisplaySlide).id === 'string' &&
          typeof (slide as CustomerDisplaySlide).title === 'string',
      )
      .sort((left, right) => left.sortOrder - right.sortOrder);
  } catch {
    return [];
  }
}

export class CustomerDisplayService {
  constructor(
    private readonly database: DatabaseClient,
    private readonly application: ApplicationService,
  ) {}

  private async requireOwner(token: string): Promise<void> {
    const actor = await this.application.authenticate(token);
    if (actor.role !== 'OWNER')
      throw new DomainError('AUTHORIZATION', 'Настройки экрана клиента доступны только владельцу.');
  }

  async getStoredSettings(): Promise<CustomerDisplaySettings> {
    const setting = await this.database.appSetting.findUnique({ where: { key: SETTINGS_KEY } });
    return parseSettings(setting?.value);
  }

  async getStoredSlides(): Promise<CustomerDisplaySlide[]> {
    const setting = await this.database.appSetting.findUnique({ where: { key: SLIDES_KEY } });
    return parseSlides(setting?.value);
  }

  async getConfiguration(token: string) {
    await this.requireOwner(token);
    return Promise.all([this.getStoredSettings(), this.getStoredSlides()]);
  }

  async updateSettings(
    token: string,
    settings: CustomerDisplaySettings,
  ): Promise<CustomerDisplaySettings> {
    await this.requireOwner(token);
    const normalized: CustomerDisplaySettings = {
      customerSeconds: Math.min(300, Math.max(3, Math.round(settings.customerSeconds))),
      displayId: settings.displayId?.trim() ? settings.displayId.trim() : undefined,
      enabled: settings.enabled,
      fullscreen: settings.fullscreen,
      showLastName: settings.showLastName,
      slideSeconds: Math.min(300, Math.max(3, Math.round(settings.slideSeconds))),
    };
    await this.database.appSetting.upsert({
      create: { key: SETTINGS_KEY, value: JSON.stringify(normalized) },
      update: { value: JSON.stringify(normalized) },
      where: { key: SETTINGS_KEY },
    });
    return normalized;
  }

  async saveSlide(
    token: string,
    input: CustomerDisplaySlideInput,
  ): Promise<CustomerDisplaySlide[]> {
    await this.requireOwner(token);
    const slides = await this.getStoredSlides();
    const existing = input.id ? slides.find((slide) => slide.id === input.id) : undefined;
    const slide: CustomerDisplaySlide = {
      displaySeconds: input.displaySeconds,
      id: existing?.id ?? crypto.randomUUID(),
      isActive: input.isActive,
      mediaId: input.mediaId,
      sortOrder: existing?.sortOrder ?? slides.length,
      text: input.text?.trim() ? input.text.trim() : undefined,
      title: input.title.trim(),
    };
    const updated = existing
      ? slides.map((item) => (item.id === existing.id ? slide : item))
      : [...slides, slide];
    await this.writeSlides(updated);
    return updated;
  }

  async deleteSlide(
    token: string,
    id: string,
  ): Promise<{ mediaId?: string; slides: CustomerDisplaySlide[] }> {
    await this.requireOwner(token);
    const slides = await this.getStoredSlides();
    const removed = slides.find((slide) => slide.id === id);
    const updated = slides
      .filter((slide) => slide.id !== id)
      .map((slide, sortOrder) => ({ ...slide, sortOrder }));
    await this.writeSlides(updated);
    return removed?.mediaId ? { mediaId: removed.mediaId, slides: updated } : { slides: updated };
  }

  async moveSlide(token: string, id: string, direction: 'UP' | 'DOWN') {
    await this.requireOwner(token);
    const slides = await this.getStoredSlides();
    const index = slides.findIndex((slide) => slide.id === id);
    const target = direction === 'UP' ? index - 1 : index + 1;
    if (index >= 0 && target >= 0 && target < slides.length) {
      const current = slides[index];
      const replacement = slides[target];
      if (current && replacement) {
        slides[index] = replacement;
        slides[target] = current;
      }
    }
    const updated = slides.map((slide, sortOrder) => ({ ...slide, sortOrder }));
    await this.writeSlides(updated);
    return updated;
  }

  private async writeSlides(slides: CustomerDisplaySlide[]): Promise<void> {
    await this.database.appSetting.upsert({
      create: { key: SLIDES_KEY, value: JSON.stringify(slides) },
      update: { value: JSON.stringify(slides) },
      where: { key: SLIDES_KEY },
    });
  }

  async getSafeStudent(token: string, studentId: string): Promise<CustomerDisplayStudent> {
    const student = await this.application.getStudent(token, studentId);
    const settings = await this.getStoredSettings();
    const enrollments = await this.database.enrollment.findMany({
      include: { group: { select: { id: true, name: true } } },
      where: {
        leftAt: null,
        status: { in: [...ACTIVE_ENROLLMENTS] },
        studentId,
      },
    });
    const groupIds = enrollments.map(({ groupId }) => groupId);
    const [finance, nextLesson, hadSubscription] = await Promise.all([
      new FinanceService(this.database, this.application).listStudentSubscriptions(
        token,
        studentId,
      ),
      groupIds.length
        ? this.database.lesson.findFirst({
            include: {
              group: { select: { name: true } },
              roomEntity: { select: { name: true } },
            },
            orderBy: { startsAt: 'asc' },
            where: {
              groupId: { in: groupIds },
              startsAt: { gte: new Date() },
              status: 'PLANNED',
            },
          })
        : Promise.resolve(null),
      this.database.subscription.count({ where: { studentId } }),
    ]);
    const current = finance.subscriptions
      .filter(({ status }) => status === 'ACTIVE' || status === 'FROZEN')
      .sort((left, right) =>
        (left.expiresAt ?? '9999').localeCompare(right.expiresAt ?? '9999'),
      )[0];
    const expiring = current?.expiresAt
      ? new Date(current.expiresAt).getTime() <= Date.now() + 5 * 86_400_000
      : false;
    return {
      firstName: student.firstName,
      groups: enrollments.map(({ group }) => group.name),
      lastNameInitial: settings.showLastName
        ? student.lastName.slice(0, 1).toLocaleUpperCase('ru-RU')
        : undefined,
      nextLesson: nextLesson
        ? {
            groupName: nextLesson.group.name,
            roomName: nextLesson.roomEntity?.name,
            startsAt: nextLesson.startsAt.toISOString(),
          }
        : undefined,
      remainingLessons: current?.remainingLessons,
      subscriptionExpiresAt: current?.expiresAt,
      subscriptionStatus: current
        ? expiring
          ? 'EXPIRING'
          : 'ACTIVE'
        : hadSubscription
          ? 'EXPIRED'
          : 'NONE',
    };
  }
}
