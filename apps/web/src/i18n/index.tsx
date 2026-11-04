import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Locale = 'de' | 'en';
export type LocalePreference = 'auto' | Locale;
const PREF_KEY = 'lq.locale';

/** Detect the supported language from navigator.languages / navigator.language. */
export function detectLocale(languages: readonly string[] | string | null | undefined): Locale {
  const list = typeof languages === 'string' ? [languages] : languages ?? [];
  return /^de/i.test(list[0]?.trim() ?? '') ? 'de' : 'en';
}

export function getDeviceLocale(): Locale {
  if (typeof navigator === 'undefined') return 'en';
  return detectLocale(navigator.languages?.length ? navigator.languages : navigator.language);
}

export function getLocalePreference(): LocalePreference {
  try {
    const saved = localStorage.getItem(PREF_KEY);
    return saved === 'de' || saved === 'en' ? saved : 'auto';
  } catch {
    return 'auto';
  }
}

export const de = {
  'Loading…': 'Lade …',
  'Try again': 'Erneut versuchen',
  'Settings': 'Einstellungen',
  'Language': 'Sprache',
  'Automatic': 'Automatisch',
  'German': 'Deutsch',
  'English': 'English',
  'Daily goal': 'Tagesziel',
  'Color theme': 'Farbschema',
  'Profile frame': 'Profilrahmen',
  'None': 'Ohne',
  'Sound': 'Ton',
  'Weekly recap': 'Wochenrückblick',
  'Notifications': 'Mitteilungen',
  'Password': 'Passwort',
  'Passkeys': 'Passkeys',
  'Account': 'Konto',
  'Email': 'E-Mail',
  'Add': 'hinzufügen',
  'unverified': 'unbestätigt',
  'Resend verification email': 'Bestätigungs-Mail erneut senden',
  'Verification email sent 📬': 'Bestätigungs-Mail gesendet 📬',
  'Saved. Please confirm the new address by email.': 'Gespeichert – bitte bestätige die neue Adresse per Mail',
  'Newsletter': 'Newsletter',
  'Unsubscribe from newsletter': 'Newsletter abbestellt',
  'Almost done — confirm the email in your inbox 📬': 'Fast geschafft – bitte bestätige die Mail in deinem Postfach 📬',
  'Add an email address first': 'Bitte zuerst eine E-Mail-Adresse hinterlegen',
  'Waiting for confirmation — check your inbox.': 'Wartet auf deine Bestätigung – schau in dein Postfach (news.quest@varialbe.xyz).',
  'Confirmed · sent to {email}': 'Bestätigt · an {email}',
  'Google linked ✅': 'Google verknüpft ✅',
  'Disconnect Google account?': 'Google-Verknüpfung trennen?',
  'Google disconnected': 'Google getrennt',
  'Linked · disconnect': 'verknüpft · trennen',
  'Connect': 'Verknüpfen',
  'Locale saved': 'Sprache gespeichert',
  'Profile': 'Profil',
  'Learning': 'Lernen',
  'Practice': 'Üben',
  'Shop': 'Shop',
  'Home': 'Start',
  'Back': 'Zurück',
  'Cancel': 'Abbrechen',
  'Save': 'Speichern',
  'Continue': 'Weiter',
  'Done': 'Fertig',
  'Search': 'Suchen',
  'No results': 'Keine Treffer',
  'Discrete Structures': 'Diskrete Strukturen',
  'Introduction to Computer Science and Programming': 'Einführung in die Informatik und Programmierung',
  'Introduction to Computer Architecture': 'Einführung in die Rechnerarchitektur',
  'Loading… plural': 'Lade …',
  'Sounds': 'Sounds',
  'Notifications description': 'Streak-Erinnerung am Abend, neue Units, Duelle',
  'Add to Home Screen on iPhone': 'iPhone: erst „Zum Home-Bildschirm“ hinzufügen',
  'Reminder off': 'Erinnerung aus',
  'Reminder on 🔔': 'Erinnerung aktiviert 🔔',
  'Sunday at 6 pm: XP, accuracy, weak concepts and due reviews': 'Sonntags um 18 Uhr: XP, Trefferquote, wackelige Konzepte, Fälliges',
  'Weekly recap on 📊': 'Wochenrückblick an 📊',
  'Weekly recap off': 'Wochenrückblick aus',
  'App version': 'App-Version',
  'Change password': 'Passwort ändern',
  'Set password': 'Passwort festlegen',
  'Admin area': 'Admin-Bereich',
  'Sign out': 'Abmelden',
  'Profile settings': 'Einstellungen',
  'Joined {date}': 'Dabei seit {date}',
  'Statistics': 'Statistik',
  'day streak · record {days}': 'Tage Streak · Rekord {days}',
  'Total XP': 'XP gesamt',
  'levels · {count} perfect': 'Level · {count} perfekt',
  'Accuracy · {count} answers': 'Trefferquote · {count} Antworten',
  'League · {xp} XP this week': 'Liga · {xp} XP diese Woche',
  'Streak freezes': 'Streak-Freezes',
  'Streak calendar': 'Streak-Kalender',
  'Modules': 'Module',
  'Achievements': 'Abzeichen',
  'Language saved': 'Sprache gespeichert',
  'Monday': 'Mo',
  'Tuesday': 'Di',
  'Wednesday': 'Mi',
  'Thursday': 'Do',
  'Friday': 'Fr',
  'Saturday': 'Sa',
  'Sunday': 'So',
  'question': 'Frage',
  'questions': 'Fragen',
  'card': 'Karte',
  'cards plural': 'Karten',
  'Request failed': 'Anfrage fehlgeschlagen',
  'No connection — are you offline?': 'Keine Verbindung – bist du offline?',
} as const;

export type TranslationKey = keyof typeof de;
export const en: Record<TranslationKey, string> = {
  'Loading…': 'Loading…',
  'Try again': 'Try again',
  Settings: 'Settings',
  Language: 'Language',
  Automatic: 'Automatic',
  German: 'Deutsch',
  English: 'English',
  'Daily goal': 'Daily goal',
  'Color theme': 'Color theme',
  'Profile frame': 'Profile frame',
  None: 'None',
  Sound: 'Sound',
  'Weekly recap': 'Weekly recap',
  Notifications: 'Notifications',
  Password: 'Password',
  Passkeys: 'Passkeys',
  Account: 'Account',
  Email: 'Email',
  Add: 'add',
  unverified: 'unverified',
  'Resend verification email': 'Resend verification email',
  'Verification email sent 📬': 'Verification email sent 📬',
  'Saved. Please confirm the new address by email.': 'Saved. Please confirm the new address by email.',
  Newsletter: 'Newsletter',
  'Unsubscribe from newsletter': 'Unsubscribe from newsletter',
  'Almost done — confirm the email in your inbox 📬': 'Almost done — confirm the email in your inbox 📬',
  'Add an email address first': 'Add an email address first',
  'Waiting for confirmation — check your inbox.': 'Waiting for confirmation — check your inbox.',
  'Confirmed · sent to {email}': 'Confirmed · sent to {email}',
  'Google linked ✅': 'Google linked ✅',
  'Disconnect Google account?': 'Disconnect Google account?',
  'Google disconnected': 'Google disconnected',
  'Linked · disconnect': 'Linked · disconnect',
  Connect: 'Connect',
  'Locale saved': 'Language saved',
  Profile: 'Profile',
  Learning: 'Learn',
  Practice: 'Practice',
  Shop: 'Shop',
  Home: 'Home',
  Back: 'Back',
  Cancel: 'Cancel',
  Save: 'Save',
  Continue: 'Continue',
  Done: 'Done',
  Search: 'Search',
  'No results': 'No results',
  'Discrete Structures': 'Discrete Structures',
  'Introduction to Computer Science and Programming': 'Introduction to Computer Science and Programming',
  'Introduction to Computer Architecture': 'Introduction to Computer Architecture',
  'Loading… plural': 'Loading…',
  Sounds: 'Sound',
  'Notifications description': 'Evening streak reminders, new units and duels',
  'Add to Home Screen on iPhone': 'On iPhone, first choose “Add to Home Screen”',
  'Reminder off': 'Reminders off',
  'Reminder on 🔔': 'Reminders enabled 🔔',
  'Sunday at 6 pm: XP, accuracy, weak concepts and due reviews': 'Sundays at 6 pm: XP, accuracy, concepts to practise and due reviews',
  'Weekly recap on 📊': 'Weekly recap on 📊',
  'Weekly recap off': 'Weekly recap off',
  'App version': 'App version',
  'Change password': 'Change password',
  'Set password': 'Set password',
  'Admin area': 'Admin area',
  'Sign out': 'Sign out',
  'Profile settings': 'Settings',
  'Joined {date}': 'Joined {date}',
  Statistics: 'Statistics',
  'day streak · record {days}': 'day streak · record {days}',
  'Total XP': 'Total XP',
  'levels · {count} perfect': 'levels · {count} perfect',
  'Accuracy · {count} answers': 'Accuracy · {count} answers',
  'League · {xp} XP this week': 'League · {xp} XP this week',
  'Streak freezes': 'Streak freezes',
  'Streak calendar': 'Streak calendar',
  Modules: 'Modules',
  Achievements: 'Achievements',
  'Language saved': 'Language saved',
  Monday: 'Mon',
  Tuesday: 'Tue',
  Wednesday: 'Wed',
  Thursday: 'Thu',
  Friday: 'Fri',
  Saturday: 'Sat',
  Sunday: 'Sun',
  question: 'question',
  questions: 'questions',
  card: 'card',
  'cards plural': 'cards',
  'Request failed': 'Request failed',
  'No connection — are you offline?': 'No connection — are you offline?',
};

type LocaleContextValue = {
  locale: Locale;
  preference: LocalePreference;
  setPreference: (value: LocalePreference) => void;
  syncAccountPreference: (value: Locale | null) => void;
};
const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<LocalePreference>(getLocalePreference);
  const [deviceLocale, setDeviceLocale] = useState<Locale>(getDeviceLocale);
  const locale = preference === 'auto' ? deviceLocale : preference;

  useEffect(() => {
    const update = () => setDeviceLocale(getDeviceLocale());
    window.addEventListener('languagechange', update);
    return () => window.removeEventListener('languagechange', update);
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setPreference = useCallback((value: LocalePreference) => {
    setPreferenceState(value);
    try {
      if (value === 'auto') localStorage.removeItem(PREF_KEY);
      else localStorage.setItem(PREF_KEY, value);
    } catch {
      // App remains usable when storage is unavailable.
    }
  }, []);
  const syncAccountPreference = useCallback((value: Locale | null) => {
    setPreference(value ?? 'auto');
  }, [setPreference]);
  const value = useMemo(() => ({ locale, preference, setPreference, syncAccountPreference }), [locale, preference, setPreference, syncAccountPreference]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const value = useContext(LocaleContext);
  if (!value) throw new Error('useLocale must be used inside LocaleProvider');
  return value;
}

export function useT() {
  const { locale } = useLocale();
  return useCallback((key: TranslationKey, values: Record<string, string | number> = {}) => {
    let message = locale === 'de' ? de[key] : en[key];
    for (const [name, value] of Object.entries(values)) message = message.replaceAll(`{${name}}`, String(value));
    return message;
  }, [locale]);
}

/** Select a singular or plural dictionary entry using the locale's normal one/other form. */
export function usePlural() {
  const t = useT();
  return useCallback((count: number, singular: TranslationKey, plural: TranslationKey) => t(count === 1 ? singular : plural), [t]);
}

export function formatNumber(value: number, locale = getDeviceLocale()): string {
  return new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-US').format(value);
}
export function formatDate(value: Date | number | string, options?: Intl.DateTimeFormatOptions, locale = getDeviceLocale()): string {
  return new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : 'en-US', options).format(new Date(value));
}

