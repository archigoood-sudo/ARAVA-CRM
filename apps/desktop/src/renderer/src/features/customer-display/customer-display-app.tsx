import type { CustomerDisplaySlide, CustomerDisplayState } from '@arava/shared';
import { useEffect, useMemo, useState } from 'react';

const statusLabels: Record<
  NonNullable<CustomerDisplayState['student']>['subscriptionStatus'],
  string
> = {
  ACTIVE: 'Абонемент активен',
  EXPIRED: 'Абонемент закончился',
  EXPIRING: 'Абонемент заканчивается',
  NONE: 'Нет активного абонемента',
};

function PromoSlide({ slide }: { slide: CustomerDisplaySlide | undefined }) {
  if (!slide) {
    return (
      <div
        data-testid="promo-slide"
        className="flex h-full w-full flex-col items-center justify-center bg-[#f6f2ea] text-center"
      >
        <div className="mb-8 flex size-28 items-center justify-center bg-[#155EEF] text-6xl font-black text-white">
          A
        </div>
        <h1 className="text-[clamp(4rem,10vw,9rem)] font-black leading-none tracking-[-0.07em] text-[#171717]">
          ARAVA
        </h1>
        <p className="mt-6 text-[clamp(1.4rem,3vw,2.8rem)] font-medium tracking-wide text-[#155EEF]">
          Студия танца
        </p>
      </div>
    );
  }

  if (slide.imageUrl) {
    return (
      <div
        data-testid="promo-slide"
        className="relative flex h-full w-full items-center justify-center overflow-hidden bg-[#f6f2ea]"
      >
        <img
          data-testid="promo-image"
          alt={slide.title ? `${slide.title} — ARAVA` : 'Рекламный баннер ARAVA'}
          className="h-auto w-auto max-h-full max-w-full object-contain"
          src={slide.imageUrl}
        />
        {(slide.title || slide.text) && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#0f172a]/65 via-[#0f172a]/18 to-transparent px-[clamp(1rem,4vw,4rem)] pb-[clamp(1.2rem,4vw,5rem)] pt-[clamp(4rem,10vw,9rem)] text-white">
            {slide.title ? <h1 className="text-4xl font-black">{slide.title}</h1> : null}
            {slide.text ? (
              <p className="mt-3 max-w-4xl text-lg text-white/95">{slide.text}</p>
            ) : null}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      data-testid="promo-slide"
      className="flex h-full w-full flex-col items-center justify-center gap-8 bg-[#f6f2ea] px-[clamp(1rem,3vw,3rem)] text-center"
    >
      {slide.title ? (
        <h1 className="text-[clamp(3rem,9vw,6.5rem)] font-black leading-none tracking-[-0.06em] text-[#171717]">
          {slide.title}
        </h1>
      ) : null}
      {slide.text ? (
        <p className="max-w-4xl text-[clamp(1.2rem,2vw,2.2rem)] leading-relaxed text-[#5f6570]">
          {slide.text}
        </p>
      ) : null}
    </div>
  );
}

function StudentView({ state }: { state: CustomerDisplayState }) {
  const student = state.student;
  if (!student) return null;
  const name = `${student.firstName}${student.lastNameInitial ? ` ${student.lastNameInitial}.` : ''}`;
  const next = student.nextLesson ? new Date(student.nextLesson.startsAt) : undefined;
  return (
    <div className="grid h-full grid-cols-1 gap-[clamp(2rem,5vw,6rem)] px-[clamp(2rem,8vw,10rem)] py-[clamp(2.5rem,7vh,7rem)] landscape:grid-cols-[1.15fr_0.85fr] landscape:items-center">
      <section>
        <p className="text-[clamp(1.4rem,3vw,2.8rem)] font-medium text-[#155EEF]">Здравствуйте,</p>
        <h1 className="mt-3 text-[clamp(4rem,10vw,10rem)] font-black leading-[0.88] tracking-[-0.07em] text-[#171717]">
          {name}!
        </h1>
        {student.groups.length ? (
          <p className="mt-10 text-[clamp(1.5rem,3vw,3rem)] font-semibold text-[#4e5562]">
            {student.groups.slice(0, 3).join(' · ')}
          </p>
        ) : null}
      </section>
      <section className="space-y-[clamp(1rem,2vh,2rem)]">
        <div className="rounded-[clamp(1.6rem,3vw,3rem)] bg-white p-[clamp(1.8rem,4vw,4rem)] shadow-[0_25px_80px_rgba(17,24,39,0.09)]">
          <p className="text-[clamp(1rem,1.8vw,1.6rem)] font-semibold text-[#687080]">
            {statusLabels[student.subscriptionStatus]}
          </p>
          {student.remainingLessons !== undefined ? (
            <>
              <p className="mt-8 text-[clamp(1.1rem,2vw,1.8rem)] text-[#687080]">
                Осталось занятий
              </p>
              <p className="mt-1 text-[clamp(4rem,8vw,8rem)] font-black leading-none tracking-tight text-[#155EEF]">
                {student.remainingLessons}
              </p>
            </>
          ) : null}
          {student.subscriptionExpiresAt ? (
            <p className="mt-8 text-[clamp(1.05rem,1.8vw,1.6rem)] text-[#4e5562]">
              Действует до{' '}
              <strong>
                {new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(
                  new Date(student.subscriptionExpiresAt),
                )}
              </strong>
            </p>
          ) : null}
        </div>
        {next && student.nextLesson ? (
          <div className="rounded-[clamp(1.6rem,3vw,3rem)] bg-[#155EEF] p-[clamp(1.8rem,4vw,4rem)] text-white">
            <p className="text-[clamp(1rem,1.8vw,1.5rem)] text-blue-100">Следующее занятие</p>
            <p className="mt-3 text-[clamp(1.8rem,3.5vw,3.5rem)] font-bold">
              {new Intl.DateTimeFormat('ru-RU', {
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                month: 'long',
                weekday: 'long',
              }).format(next)}
            </p>
            <p className="mt-2 text-[clamp(1rem,1.7vw,1.5rem)] text-blue-100">
              {student.nextLesson.groupName}
              {student.nextLesson.roomName ? ` · ${student.nextLesson.roomName}` : ''}
            </p>
          </div>
        ) : null}
      </section>
    </div>
  );
}

export function CustomerDisplayApp() {
  const [state, setState] = useState<CustomerDisplayState>();
  const [slideIndex, setSlideIndex] = useState(0);
  const slides = state?.slides ?? [];
  const slide = slides[slideIndex % Math.max(slides.length, 1)];
  const duration = (slide?.displaySeconds ?? state?.settings.slideSeconds ?? 8) * 1000;

  useEffect(() => {
    document.title = 'ARAVA — Экран клиента';
    void window.customerDisplayView?.getState().then(setState);
    return window.customerDisplayView?.subscribe(setState);
  }, []);
  useEffect(() => setSlideIndex(0), [slides.length]);
  useEffect(() => {
    if (state?.mode !== 'PROMO' || slides.length < 2) return;
    const timer = window.setTimeout(
      () => setSlideIndex((index) => (index + 1) % slides.length),
      duration,
    );
    return () => window.clearTimeout(timer);
  }, [duration, slides.length, slideIndex, state?.mode]);

  const content = useMemo(
    () =>
      state?.mode === 'STUDENT' ? <StudentView state={state} /> : <PromoSlide slide={slide} />,
    [slide, state],
  );
  return (
    <main
      data-mode={state?.mode === 'STUDENT' ? 'student' : 'promo'}
      data-testid="customer-display-root"
      className="fixed inset-0 h-full w-full overflow-hidden bg-[#f6f2ea] text-[#171717] antialiased"
    >
      {content}
    </main>
  );
}
