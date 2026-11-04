/** Fetch-Wrapper: Bearer-Token (Browser + Capacitor), JSON, deutsche Fehlermeldungen. */
import { getDeviceLocale, getLocalePreference } from '../i18n/index.tsx';
const BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';
const TOKEN_KEY = 'lq.token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string | null) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

export async function api<T>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const preference = getLocalePreference();
  const deviceLocale = getDeviceLocale();
  const locale = preference === 'auto' ? deviceLocale : preference;
  const headers: Record<string, string> = {
    'accept-language': locale === 'de' ? 'de' : 'en',
    'x-lq-locale': preference,
    'x-lq-device-locale': deviceLocale,
  };
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { method: opts.method ?? 'GET', headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined, signal: opts.signal });
  } catch {
    throw new ApiError(0, 'offline', locale === 'de' ? 'Keine Verbindung – bist du offline?' : 'No connection — are you offline?');
  }
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized?.();
    const code = json?.error ?? 'error';
    const german = locale === 'de';
    const known: Record<string, string> = {
      invalid_credentials: german ? 'Benutzername/E-Mail oder Passwort falsch.' : 'Incorrect username/email or password.',
      google_only: german ? 'Dieses Konto nutzt „Mit Google anmelden“. Über „Passwort vergessen?“ kannst du zusätzlich ein Passwort festlegen.' : 'This account uses Google sign-in. Use “Forgot password?” to set a password as well.',
      disabled: german ? 'Dein Account ist gesperrt.' : 'Your account is disabled.',
      unauthorized: german ? 'Bitte melde dich an.' : 'Please sign in.',
      forbidden: german ? 'Dafür hast du keine Berechtigung.' : 'You do not have permission to do that.',
      username_taken: german ? 'Benutzername ist schon vergeben.' : 'That username is already taken.',
      wrong_password: german ? 'Aktuelles Passwort ist falsch.' : 'The current password is incorrect.',
      rate_limited: german ? 'Zu viele Versuche – bitte warte kurz.' : 'Too many attempts. Please wait a moment.',
      validation: german ? 'Bitte prüfe deine Eingaben.' : 'Please check your entries.',
      internal: german ? 'Interner Fehler' : 'Something went wrong.',
      error: german ? `Fehler ${res.status}` : `Request failed (${res.status})`,
    };
    const message = known[code] ?? (german ? json?.message ?? `Fehler ${res.status}` : 'Request failed');
    throw new ApiError(res.status, code, message);
  }
  return json as T;
}

/** Bilder liegen in public/assets; in der iOS-App relativ zum Bundle. */
export const assetUrl = (name: string) => `${import.meta.env.BASE_URL}assets/${name}.webp`;
