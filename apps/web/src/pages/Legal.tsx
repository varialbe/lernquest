import type { ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { Icon } from '../components/icons.tsx';
import { useLocale } from '../i18n/index.tsx';

const OWNER = { name: 'Mateen Batt', street: 'Neustifter Straße 37', city: '80807 München', email: 'varialbe@varialbe.xyz' };
const UPDATED = '4. November 2026';

/** © unten auf Login, Profil und den Rechtsseiten */
export function Copyright({ className = '' }: { className?: string }) {
  const { locale } = useLocale();
  return (
    <p className={`text-center text-xs font-bold text-muted ${className}`}>
      © {Math.max(2026, new Date().getFullYear())} {OWNER.name} ·{' '}
      <Link href="/impressum" className="hover:underline">
        {locale === 'en' ? 'Legal notice' : 'Impressum'}
      </Link>
      {' · '}
      <Link href="/datenschutz" className="hover:underline">
        {locale === 'en' ? 'Privacy' : 'Datenschutz'}
      </Link>
    </p>
  );
}

function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
  const [, navigate] = useLocation();
  const { locale } = useLocale();
  return (
    <div className="min-h-dvh bg-bg">
      <header className="safe-top sticky top-0 z-20 border-b-2 border-line bg-bg/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-xl items-center gap-2 px-3">
          <button onClick={() => (history.length > 1 ? history.back() : navigate('/'))} aria-label={locale === 'en' ? 'Back' : 'Zurück'} className="rounded-xl p-1.5 text-muted hover:bg-surface-2">
            <Icon name="chevronLeft" size={26} weight={2.8} />
          </button>
          <h1 className="text-lg font-black">{title}</h1>
        </div>
      </header>
      <main className="legal mx-auto max-w-xl px-5 pb-16 pt-4 text-[0.95rem] font-semibold leading-relaxed text-ink/90">
        {children}
        <Copyright className="mt-10" />
      </main>
    </div>
  );
}

const H = ({ children }: { children: ReactNode }) => <h2 className="mb-1.5 mt-6 text-lg font-black text-ink">{children}</h2>;
const Mail = () => (
  <a href={`mailto:${OWNER.email}`} className="font-bold text-primary underline">
    {OWNER.email}
  </a>
);
const Address = () => (
  <p>
    {OWNER.name}
    <br />
    {OWNER.street}
    <br />
    {OWNER.city}
    <br />
    E-Mail: <Mail />
  </p>
);

export function Impressum() {
  const { locale } = useLocale();
  return (
    <LegalLayout title="Impressum">
      {locale === 'en' && (
        <section className="rounded-2xl border-2 border-line bg-surface p-4">
          <H>English summary</H>
          <p>LernQuest is a private, non-commercial learning project for students. The operator and responsible person is {OWNER.name}, {OWNER.street}, {OWNER.city}. Email: <Mail />. The German version is legally binding.</p>
        </section>
      )}
      <H>Angaben gemäß § 5 DDG</H>
      <Address />
      <H>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</H>
      <p>
        {OWNER.name}, {OWNER.street}, {OWNER.city}
      </p>
      <H>Über LernQuest</H>
      <p>LernQuest ist ein privates, nicht-kommerzielles Lernprojekt für Studierende. Es gibt keine Werbung und keine kostenpflichtigen Angebote.</p>
      <H>Haftung für Inhalte</H>
      <p>
        Die Quizfragen werden automatisiert mit KI aus eigenen Vorlesungsmitschriften erzeugt und maschinell geprüft. Trotz Sorgfalt können Fehler enthalten sein. Die Inhalte ersetzen keine Vorlesung, kein Skript und keine offizielle Prüfungsvorbereitung. Fehlerhafte Fragen
        kannst du in der App melden.
      </p>
      <H>Haftung für Links</H>
      <p>Für Inhalte verlinkter externer Seiten sind ausschließlich deren Betreiber verantwortlich. Bei Bekanntwerden von Rechtsverletzungen werden entsprechende Links umgehend entfernt.</p>
      <p className="mt-8 text-sm text-muted">
        Siehe auch die{' '}
        <Link href="/datenschutz" className="font-bold text-primary underline">
          Datenschutzerklärung
        </Link>
        .
      </p>
    </LegalLayout>
  );
}

export function Datenschutz() {
  const { locale } = useLocale();
  return (
    <LegalLayout title="Datenschutz">
      {locale === 'en' && (
        <section className="rounded-2xl border-2 border-line bg-surface p-4">
          <H>English summary</H>
          <p>LernQuest processes account details, learning progress and settings to provide the app. The server is in Germany. Data is not sold; there are no ads, analytics or cookies. Your language preference and detected device language are stored so the app and account notifications use the right language. You can change your language preference in your profile. The German version is legally binding.</p>
        </section>
      )}
      <p>Diese Erklärung beschreibt, welche personenbezogenen Daten LernQuest (Web-App unter lern.varialbe.xyz und mateenbatt.de/lernen sowie die iOS-App) verarbeitet, wozu und wie lange.</p>

      <H>1. Verantwortlicher</H>
      <Address />

      <H>2. Das Wichtigste in Kürze</H>
      <ul className="list-disc pl-5">
        <li>Keine Werbung, kein Tracking, keine Analyse-Dienste, keine Cookies.</li>
        <li>Daten werden nicht verkauft und nur dort weitergegeben, wo es unten ausdrücklich steht.</li>
        <li>Der Server steht in Deutschland. Schriftarten und alle Inhalte kommen vom eigenen Server.</li>
      </ul>

      <H>3. Hosting</H>
      <p>
        Die App läuft auf einem Server der Contabo GmbH, Aschauer Straße 32a, 81549 München. Contabo verarbeitet die Daten ausschließlich in unserem Auftrag (Art. 28 DSGVO). Rechtsgrundlage: Art. 6 Abs. 1 lit. b und f DSGVO.
      </p>

      <H>4. Server-Logfiles</H>
      <p>
        Beim Aufruf speichert der Webserver automatisch IP-Adresse, Datum und Uhrzeit, aufgerufene Adresse, Statuscode, übertragene Datenmenge, Referrer und Browser-/App-Kennung. Zweck: sicherer und stabiler Betrieb, Abwehr von Angriffen. Rechtsgrundlage: Art. 6 Abs. 1 lit. f
        DSGVO. Die Logfiles werden nach 14 Tagen automatisch gelöscht.
      </p>

      <H>5. Benutzerkonto</H>
      <p>
        Für die Nutzung brauchst du ein Konto. Gespeichert werden Benutzername, Anzeigename, deine E-Mail-Adresse, das Passwort ausschließlich als Argon2id-Hash (nie im Klartext), der Zeitpunkt, zu dem du diese Datenschutzerklärung bestätigt hast, und deine Einstellungen (Tagesziel,
        Farbschema, Ton, Profilrahmen, aktives Pet sowie die Sprachwahl: Automatisch, Deutsch oder English). Bei „Automatisch“ speichern wir zusätzlich die erkannte Gerätesprache, damit Push-Mitteilungen und E-Mails in der passenden Sprache erstellt werden können. Gibst du freiwillig einen Einladungscode an, speichern wir ihn, damit der Betreiber sieht, über wen du gekommen bist. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO (Bereitstellung der App).
      </p>
      <p className="mt-2">
        Für jede Anmeldung wird eine Sitzung angelegt: ein zufälliger Schlüssel (auf dem Server nur als Hash), die Browser-/App-Kennung und Zeitpunkte von Anmeldung und letzter Nutzung. Abgelaufene oder abgemeldete Sitzungen werden gelöscht.
      </p>

      <H>5a. E-Mail-Adresse und Sicherheit</H>
      <p>
        Deine E-Mail-Adresse nutzen wir, um sie zu bestätigen, für Links zum Zurücksetzen des Passworts und – nur mit deiner Einwilligung – für den Newsletter. In der Datenbank liegt sie ausschließlich verschlüsselt (AES-256); gesucht wird über einen
        geschlüsselten Hash. Links aus E-Mails (Bestätigen, Passwort zurücksetzen) speichern wir nur als Hash, sie sind zeitlich begrenzt und nur einmal gültig. Die Mails versenden wir über unseren eigenen Mailserver auf demselben Server (Absender
        lernquest.reset@varialbe.xyz und news.quest@varialbe.xyz).
      </p>

      <H>5b. Anmeldung mit Google</H>
      <p>
        Wenn du „Mit Google anmelden/registrieren“ wählst, leitet dich die App zu Google (Google Ireland Limited, Gordon House, Barrow Street, Dublin 4, Irland) weiter. Nach deiner Zustimmung übermittelt Google uns deine Google-Kennung, deine E-Mail-Adresse, ob sie
        bestätigt ist, und deinen Namen. Wir speichern die Kennung und die E-Mail-Adresse (verschlüsselt), um dich wiederzuerkennen. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO; die Nutzung von Google ist freiwillig, du kannst dich auch mit Benutzername/E-Mail und
        Passwort registrieren. Für die Verarbeitung bei Google gilt dessen Datenschutzerklärung (policies.google.com/privacy). Die Verknüpfung kannst du im Profil trennen.
      </p>

      <H>6. Newsletter (freiwillig)</H>
      <p>
        Nur wenn du bei der Registrierung oder im Profil „Newsletter abonnieren“ wählst, schicken wir dir gelegentlich Neuigkeiten zu LernQuest. Wir nutzen das Double-Opt-in-Verfahren: Erst nachdem du den Link in unserer Bestätigungs-Mail angeklickt hast, bekommst du
        den Newsletter. Zum Nachweis speichern wir die Zeitpunkte von Anmeldung und Bestätigung. Rechtsgrundlage: deine Einwilligung (Art. 6 Abs. 1 lit. a DSGVO). Abbestellen kannst du jederzeit per Link in jeder Mail, im Profil oder per E-Mail. Für den Versand
        speichern wir keine Öffnungs- oder Klickstatistiken.
      </p>

      <H>6a. Passkeys</H>
      <p>
        Wenn du einen Passkey anlegst, speichern wir nur den öffentlichen Schlüssel, die Kennung des Passkeys, den von dir sichtbaren Namen und Zeitstempel. Der private Schlüssel und deine biometrischen Daten (Face ID, Touch ID) verlassen dein Gerät nie. Passkeys kannst
        du im Profil jederzeit entfernen.
      </p>

      <H>7. Lernfortschritt und Spielfunktionen</H>
      <p>
        Gespeichert werden deine Antworten, Level-Fortschritt, Wiederholungsplan, Karteikarten-Fortschritt (welche Karte in welcher Box liegt und wann sie wieder fällig ist), XP, Coins, Streak, Pets, Shop-Käufe, Tagesaufgaben, selbst eingetragene Lernblöcke (Fach und Tag, an dem du einen 90-Minuten-Block eingetragen hast, sowie abgeholte Wochenbelohnungen), Klausur-Checks, Duelle und Ligaplatzierungen sowie Meldungen zu Fragen inklusive deines optionalen Kommentars. Rechtsgrundlage: Art. 6 Abs. 1 lit.
        b DSGVO.
      </p>
      <p className="mt-2">
        <strong>Für andere Mitglieder sichtbar</strong> sind dein Anzeigename, dein Pet/Avatar und Profilrahmen, XP, Streak, Ligaplatzierung, freigeschaltete Abzeichen sowie Ergebnisse von Duellen mit dir. Alle Mitglieder sehen sich
        gegenseitig.
      </p>

      <H>8. Benachrichtigungen</H>
      <p>
        <strong>Web-App:</strong> Nur wenn du Erinnerungen aktivierst, speichern wir die Push-Adresse deines Browsers. Die Nachrichten werden über den Push-Dienst deines Geräteherstellers zugestellt (bei iPhone/Safari: Apple). Dieser erfährt dabei die Push-Adresse und den
        Nachrichteninhalt (z. B. Streak-Erinnerung, neue Lektion, Duell, Wochenrückblick). Rechtsgrundlage: deine Einwilligung (Art. 6 Abs. 1 lit. a DSGVO), die du in den Einstellungen jederzeit widerrufen kannst.
      </p>
      <p className="mt-2">
        <strong>iOS-App:</strong> Erinnerungen werden lokal auf dem Gerät geplant. Dafür werden keine Daten an uns oder Dritte übertragen.
      </p>
      <p className="mt-2">
        <strong>Wochenrückblick:</strong> Wenn Mitteilungen aktiv sind, bekommst du sonntags um 18 Uhr eine Zusammenfassung deiner Woche: gesammelte XP (mit Vergleich zur Vorwoche), Anzahl beantworteter Fragen und Trefferquote, deine Streak, bis zu zwei Konzepte mit
        niedriger Trefferquote und die Zahl fälliger Wiederholungen und Karteikarten. Der Rückblick wird aus deinen ohnehin gespeicherten Lerndaten (Abschnitt 7) berechnet, es werden dafür keine zusätzlichen Daten erhoben. In der Web-App läuft er über den oben genannten
        Push-Dienst, der damit auch diese Zahlen sieht; in der iOS-App wird er lokal geplant. Du kannst den Wochenrückblick im Profil getrennt ausschalten, ohne die übrigen Mitteilungen abzustellen. Rechtsgrundlage: deine Einwilligung (Art. 6 Abs. 1 lit. a DSGVO).
      </p>

      <H>9. Lokaler Speicher auf deinem Gerät</H>
      <p>
        Die App speichert im lokalen Speicher deines Browsers bzw. der App: den Anmeldeschlüssel, ob auf dem Gerät schon ein Konto benutzt wurde (damit die Anmeldung statt der Begrüßung erscheint), Ton- und Farbeinstellungen, die Sprachwahl, das zuletzt gewählte Modul, ob Mitteilungen in der iOS-App aktiv sind, offline beantwortete Level, bis sie übertragen sind, und zwischengespeicherte Lerninhalte (z. B. die Wissenssammlung) für die Offline-Nutzung. Das ist für die Funktion technisch erforderlich (§ 25 Abs. 2 Nr. 2
        TDDDG). Es werden keine Cookies gesetzt.
      </p>

      <H>10. iOS-App: Updates und Fehlerberichte</H>
      <p>
        Die iOS-App lädt neue Versionen von unserem eigenen Server. Schlägt ein Update oder die Haptik fehl, sendet sie die App-Version und eine kurze technische Fehlermeldung an unseren Server, um den Fehler beheben zu können (Art. 6 Abs. 1 lit. f DSGVO). Es gibt keine
        Telemetrie an Dritte.
      </p>

      <H>11. Backups</H>
      <p>
        Die Datenbank wird nachts gesichert. Lokale Sicherungen auf dem Server werden nach 14 Tagen gelöscht. Zusätzlich wird eine Sicherung auf dem Server mit <em>age</em> verschlüsselt und erst dann in einem privaten Repository bei GitHub Inc. (USA) abgelegt. GitHub
        erhält nur verschlüsselte Daten und kann sie nicht lesen. Ältere Versionen bleiben dort verschlüsselt gespeichert. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO (Schutz vor Datenverlust).
      </p>

      <H>12. Erstellung der Lerninhalte</H>
      <p>
        Die Quizfragen werden aus den Vorlesungsmitschriften des Betreibers mit einem KI-Dienst (OpenAI) erzeugt und geprüft. Dabei werden <strong>keine</strong> Daten von Nutzerinnen und Nutzern übertragen. Betriebsmeldungen der Generierung erhält nur der Betreiber
        per Telegram, ebenfalls ohne Nutzerdaten.
      </p>

      <H>13. Speicherdauer und Löschung</H>
      <p>Kontodaten und Lernfortschritt bleiben gespeichert, solange dein Konto besteht. Wenn du dein Konto löschen lassen möchtest, schreib eine E-Mail an <Mail />. Dann werden alle zugehörigen Daten gelöscht, aus den Backups spätestens mit deren Ablauf.</p>

      <H>14. Deine Rechte</H>
      <p>
        Du hast das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18), Datenübertragbarkeit (Art. 20) und Widerspruch gegen Verarbeitungen auf Grundlage von Art. 6 Abs. 1 lit. f (Art. 21). Eine
        Einwilligung kannst du jederzeit mit Wirkung für die Zukunft widerrufen. Eine formlose E-Mail an <Mail /> genügt.
      </p>
      <p className="mt-2">
        Du kannst dich außerdem bei einer Datenschutz-Aufsichtsbehörde beschweren, zum Beispiel beim Bayerischen Landesamt für Datenschutzaufsicht (BayLDA), Promenade 18, 91522 Ansbach.
      </p>

      <p className="mt-8 text-sm text-muted">Stand: {UPDATED}</p>
    </LegalLayout>
  );
}
