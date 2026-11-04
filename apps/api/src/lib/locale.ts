export type Locale = 'de' | 'en';
export type LocalePreference = 'auto' | Locale;

const firstHeader = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)?.trim();

export function detectLocale(value: string | string[] | undefined): Locale {
  const header = firstHeader(value)?.split(',')[0]?.split(';')[0]?.trim() ?? '';
  return /^de/i.test(header) ? 'de' : 'en';
}

export function deviceLocaleFromHeaders(headers: Record<string, string | string[] | undefined>): Locale {
  const explicit = firstHeader(headers['x-lq-device-locale']);
  if (explicit === 'de' || explicit === 'en') return explicit;
  return detectLocale(headers['accept-language']);
}

export function preferenceFromHeaders(headers: Record<string, string | string[] | undefined>): Locale | null {
  const value = firstHeader(headers['x-lq-locale']);
  return value === 'de' || value === 'en' ? value : null;
}

export function localeForUser(user: { locale: Locale | null; deviceLocale: Locale }): Locale {
  return user.locale ?? user.deviceLocale;
}

