import type { GlobalSearchResult, GlobalSearchType } from '@arava/shared';
import { cn } from '@arava/ui';
import { useQuery } from '@tanstack/react-query';
import { Building2, DoorOpen, IdCard, Search, Shapes, UserRound, UsersRound } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';

import { getDesktopApi } from '../lib/desktop-api';
import { getSessionToken } from '../stores/auth-store';

const groupLabels: Record<GlobalSearchType, string> = {
  BRANCH: 'Филиалы',
  CARD: 'Карты',
  GROUP: 'Группы',
  ROOM: 'Залы',
  STUDENT: 'Ученики',
  TRAINER: 'Тренеры',
};
const icons = {
  BRANCH: Building2,
  CARD: IdCard,
  GROUP: Shapes,
  ROOM: DoorOpen,
  STUDENT: UsersRound,
  TRAINER: UserRound,
} satisfies Record<GlobalSearchType, typeof Search>;
const groupOrder: GlobalSearchType[] = ['STUDENT', 'GROUP', 'TRAINER', 'CARD', 'BRANCH', 'ROOM'];

function editableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
}

export function GlobalSearch() {
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLocaleLowerCase() !== 'k') return;
      if (editableTarget(event.target)) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', shortcut, true);
    return () => window.removeEventListener('keydown', shortcut, true);
  }, []);
  useEffect(() => {
    if (open) window.setTimeout(() => input.current?.focus(), 0);
  }, [open]);

  const results = useQuery({
    enabled: open && debounced.length >= 2,
    queryFn: () => getDesktopApi().globalSearch.query(getSessionToken(), debounced),
    queryKey: ['global-search', debounced],
    retry: false,
    staleTime: 15_000,
  });
  const rawItems = useMemo(() => results.data ?? [], [results.data]);
  const grouped = useMemo(
    () =>
      groupOrder
        .map((type) => ({ items: rawItems.filter((item) => item.type === type), type }))
        .filter((group) => group.items.length > 0),
    [rawItems],
  );
  const items = grouped.flatMap((group) => group.items);
  const close = () => {
    setOpen(false);
    setQuery('');
    setDebounced('');
    setActiveIndex(-1);
  };
  const select = async (result: GlobalSearchResult) => {
    close();
    await navigate(result.route);
  };
  useEffect(() => {
    if (!open) return;
    const navigateResults = (event: KeyboardEvent) => {
      const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-search-result]')];
      const focusedIndex = buttons.findIndex((button) => button === document.activeElement);
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && buttons.length) {
        event.preventDefault();
        const index =
          event.key === 'ArrowDown'
            ? (focusedIndex + 1) % buttons.length
            : focusedIndex <= 0
              ? buttons.length - 1
              : focusedIndex - 1;
        const target = buttons[index];
        if (target) {
          input.current?.setAttribute('aria-activedescendant', target.id);
          target.focus();
        }
        return;
      }
      if (event.key === 'Enter' && document.activeElement === input.current && buttons[0]) {
        event.preventDefault();
        buttons[0].click();
      }
    };
    window.addEventListener('keydown', navigateResults, true);
    return () => window.removeEventListener('keydown', navigateResults, true);
  }, [open]);

  return (
    <>
      <button
        aria-label="Поиск по приложению"
        className="mr-2 flex h-10 w-60 items-center gap-2.5 rounded-xl border border-border bg-surface px-3 text-sm text-muted-foreground transition hover:border-foreground/20 hover:text-foreground"
        onClick={() => setOpen(true)}
        type="button"
      >
        <Search className="size-4" />
        <span>Поиск по приложению</span>
        <kbd className="ml-auto rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium">
          ⌘K
        </kbd>
      </button>
      {open
        ? createPortal(
            <div
              className="fixed inset-0 z-[90] flex items-start justify-center bg-neutral-950/30 px-6 pt-[12vh] backdrop-blur-[2px]"
              onMouseDown={(event) => event.target === event.currentTarget && close()}
              role="presentation"
            >
              <section
                aria-label="Глобальный поиск"
                className="w-full max-w-2xl overflow-hidden rounded-3xl border border-border bg-surface shadow-elevated"
              >
                <div className="flex items-center gap-3 border-b border-border px-5">
                  <Search className="size-5 text-muted-foreground" />
                  <input
                    aria-label="Поиск по приложению"
                    className="h-16 min-w-0 flex-1 bg-transparent text-lg outline-none placeholder:text-muted-foreground"
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setActiveIndex(-1);
                    }}
                    maxLength={120}
                    placeholder="Имя, телефон, группа, филиал или карта"
                    ref={input}
                    value={query}
                  />
                  <kbd className="rounded-lg border border-border bg-muted px-2 py-1 text-xs text-muted-foreground">
                    Esc
                  </kbd>
                </div>
                <div className="max-h-[58vh] min-h-28 overflow-y-auto p-3">
                  {query.trim().length < 2 ? (
                    <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                      Введите минимум два символа для поиска
                    </p>
                  ) : results.isLoading || debounced !== query.trim() ? (
                    <p className="px-4 py-8 text-center text-sm text-muted-foreground">Ищем…</p>
                  ) : results.isError ? (
                    <p className="px-4 py-8 text-center text-sm text-destructive">
                      Не удалось выполнить поиск
                    </p>
                  ) : items.length === 0 ? (
                    <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                      Ничего не найдено
                    </p>
                  ) : (
                    grouped.map((group) => (
                      <div className="mb-3 last:mb-0" key={group.type}>
                        <p className="px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                          {groupLabels[group.type]}
                        </p>
                        {group.items.map((result) => {
                          const Icon = icons[result.type];
                          const index = items.indexOf(result);
                          return (
                            <button
                              aria-selected={index === activeIndex}
                              className={cn(
                                'flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition focus:bg-accent-soft focus:outline-none',
                                index === activeIndex ? 'bg-accent-soft' : 'hover:bg-muted',
                              )}
                              data-search-result
                              id={`global-search-result-${String(index)}`}
                              key={`${result.type}:${result.id}`}
                              onClick={() => void select(result)}
                              onFocus={() => setActiveIndex(index)}
                              type="button"
                            >
                              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                                <Icon className="size-4" />
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-semibold">
                                  {result.title}
                                </span>
                                {result.subtitle ? (
                                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                                    {result.subtitle}
                                  </span>
                                ) : null}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ))
                  )}
                </div>
                <footer className="flex gap-4 border-t border-border px-5 py-3 text-[11px] text-muted-foreground">
                  <span>↑↓ — выбор</span>
                  <span>Enter — открыть</span>
                  <span>Esc — закрыть</span>
                </footer>
              </section>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
