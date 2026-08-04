import { ru, type RussianTranslationKey } from './ru';

export const DEFAULT_LOCALE = 'ru' as const;
export const SUPPORTED_LOCALES = ['ru'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];
export type TranslationKey = RussianTranslationKey;
export type TranslationVariables = Readonly<Record<string, number | string>>;

const catalogs: Record<Locale, Record<TranslationKey, string>> = { ru };

let currentLocale: Locale = DEFAULT_LOCALE;

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: Locale): void {
  currentLocale = locale;
}

export function translate(key: TranslationKey, variables?: TranslationVariables): string {
  const template = catalogs[currentLocale][key];
  if (!variables) return template;

  return Object.entries(variables).reduce(
    (message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
    template,
  );
}

export const t = translate;

export function formatDate(
  value: Date | number | string,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' },
): string {
  return new Intl.DateTimeFormat('ru-RU', options).format(new Date(value));
}

export { ru } from './ru';
