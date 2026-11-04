import nodemailer, { type Transporter } from 'nodemailer';
import type { Locale } from './locale.ts';

/**
 * E-Mails per SMTP an den lokalen Postfix (127.0.0.1:25, DKIM-Signatur mail2026 für @varialbe.xyz).
 * Nicht über das sendmail-Binary: das braucht setgid postdrop, die Dienste laufen mit NoNewPrivileges.
 * Account-Mails (Bestätigung, Passwort-Reset) kommen von MAIL_FROM_ACCOUNT, der Newsletter von MAIL_FROM_NEWS.
 * In Tests (MAIL_TRANSPORT=memory oder VITEST) werden Mails nur in `sentMails` gesammelt.
 */

export type Mail = { to: string; subject: string; html: string; text: string; from?: 'account' | 'news'; headers?: Record<string, string> };
export const sentMails: Mail[] = [];

let transport: Transporter | null = null;
function getTransport(): Transporter | null {
  if (process.env.MAIL_TRANSPORT === 'memory' || process.env.VITEST) return null;
  transport ??= nodemailer.createTransport({ host: process.env.SMTP_HOST || '127.0.0.1', port: Number(process.env.SMTP_PORT || 25), secure: false, ignoreTLS: true, name: 'lern.varialbe.xyz' });
  return transport;
}

const FROM = {
  account: () => process.env.MAIL_FROM_ACCOUNT || 'LernQuest <lernquest.reset@varialbe.xyz>',
  news: () => process.env.MAIL_FROM_NEWS || 'LernQuest News <news.quest@varialbe.xyz>',
};

export async function sendMail(m: Mail): Promise<void> {
  const t = getTransport();
  if (!t) {
    sentMails.push(m);
    return;
  }
  await t.sendMail({ from: FROM[m.from ?? 'account'](), to: m.to, subject: m.subject, html: m.html, text: m.text, headers: m.headers });
}

// ---------- Adressen der App ----------
const origins = () => (process.env.WEB_ORIGIN ?? 'http://localhost:5173').split(',').map((s) => s.trim()).filter((s) => /^https?:\/\//.test(s));
/** Basis-URL der App für eine aufrufende Origin (mateenbatt.de läuft unter /lernen). Unbekannt/iOS-App → Haupt-Domain. */
export function appUrl(origin?: string | null): string {
  const o = origin && origins().includes(origin) ? origin : origins()[0]!;
  return /mateenbatt\.de$/.test(new URL(o).hostname) ? `${o}/lernen` : o;
}
/** Öffentliche API-Basis für Links in Mails (Bestätigen, Abmelden) */
export const apiUrl = () => `${origins()[0]}/api`;

// ---------- Layout ----------
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const OWNER = 'Mateen Batt · Neustifter Straße 37 · 80807 München';

/**
 * Gemeinsames HTML-Layout (Tabellen + Inline-CSS, damit es in Gmail, Apple Mail und Outlook gleich aussieht).
 * `footer` = zusätzlicher Footer-Text (z. B. Abmeldelink beim Newsletter).
 */
export function layout(o: { title: string; preheader?: string; body: string; footer?: string; app?: string; locale?: Locale }): string {
  const app = o.app ?? appUrl();
  const locale = o.locale ?? 'de';
  const english = locale === 'en';
  return `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(o.title)}</title></head>
<body style="margin:0;padding:0;background:#f6f4ff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#241d3d">
<span style="display:none!important;opacity:0;color:transparent;height:0;width:0;overflow:hidden">${esc(o.preheader ?? '')}</span>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f4ff;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px">
  <tr><td style="padding:4px 8px 16px">
    <table role="presentation" cellspacing="0" cellpadding="0"><tr>
      <td style="width:40px;height:40px;border-radius:12px;background:#7c5cff;color:#fff;font-weight:900;font-size:20px;text-align:center;vertical-align:middle">L</td>
      <td style="padding-left:10px;font-size:20px;font-weight:900;color:#7c5cff;letter-spacing:-.3px">LernQuest</td>
    </tr></table>
  </td></tr>
  <tr><td style="background:#ffffff;border-radius:24px;padding:28px 28px 24px;border:2px solid #e4def7;box-shadow:0 8px 24px -12px rgba(60,40,140,.18);font-size:16px;line-height:1.55">
    ${o.body}
  </td></tr>
  <tr><td style="padding:20px 12px 8px;text-align:center;font-size:12px;line-height:1.6;color:#6f6790">
    ${o.footer ? `<p style="margin:0 0 10px">${o.footer}</p>` : ''}
    <p style="margin:0 0 6px"><a href="${esc(app)}" style="color:#7c5cff;font-weight:700;text-decoration:none">${english ? 'Open LernQuest' : 'LernQuest öffnen'}</a>
      &nbsp;·&nbsp;<a href="${esc(app)}/impressum" style="color:#6f6790">${english ? 'Legal notice' : 'Impressum'}</a>
      &nbsp;·&nbsp;<a href="${esc(app)}/datenschutz" style="color:#6f6790">${english ? 'Privacy policy' : 'Datenschutz'}</a></p>
    <p style="margin:0">© ${new Date().getFullYear()} ${esc(OWNER)}</p>
  </td></tr>
</table></td></tr></table></body></html>`;
}

export const button = (href: string, label: string) =>
  `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:22px 0"><tr><td style="border-radius:16px;background:#7c5cff;box-shadow:0 4px 0 #5b3fd6"><a href="${esc(href)}" style="display:inline-block;padding:14px 26px;color:#ffffff;font-weight:800;font-size:16px;text-decoration:none">${esc(label)}</a></td></tr></table>`;

const p = (s: string) => `<p style="margin:0 0 12px">${s}</p>`;
const h = (s: string) => `<h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;font-weight:900">${s}</h1>`;
const small = (s: string) => `<p style="margin:16px 0 0;font-size:13px;color:#6f6790">${s}</p>`;

// ---------- Account-Mails ----------
export function verifyMail(o: { to: string; name: string; link: string; app: string; locale?: Locale }): Mail {
  const en = o.locale === 'en';
  return {
    to: o.to,
    subject: en ? 'Verify your email address for LernQuest' : 'Bestätige deine E-Mail-Adresse für LernQuest',
    html: layout({
      title: en ? 'Verify your email' : 'E-Mail bestätigen',
      preheader: en ? 'One click to verify your address.' : 'Ein Klick, dann ist deine Adresse bestätigt.',
      app: o.app,
      locale: o.locale,
      body: en ? h(`Hi ${esc(o.name)} 👋`) + p('Please verify your email address. You can use it to reset your password if you forget it.') + button(o.link, 'Verify email') + small("This link is valid for 7 days. If you did not create a LernQuest account, you can ignore this email.") : h(`Hallo ${esc(o.name)} 👋`) + p('bitte bestätige deine E-Mail-Adresse. Damit kannst du dein Passwort zurücksetzen, falls du es mal vergisst.') + button(o.link, 'E-Mail bestätigen') + small('Der Link ist 7 Tage gültig. Du hast kein Konto bei LernQuest angelegt? Dann ignoriere diese Mail einfach.'),
    }),
    text: en ? `Hi ${o.name},\n\nPlease verify your email address for LernQuest:\n${o.link}\n\nThis link is valid for 7 days. If you did not create an account, ignore this email.\n\n— LernQuest · ${OWNER}` : `Hallo ${o.name},\n\nbitte bestätige deine E-Mail-Adresse für LernQuest:\n${o.link}\n\nDer Link ist 7 Tage gültig. Du hast kein Konto angelegt? Dann ignoriere diese Mail.\n\n— LernQuest · ${OWNER}`,
  };
}

export function resetMail(o: { to: string; name: string; username: string; link: string; app: string; locale?: Locale }): Mail {
  const en = o.locale === 'en';
  return {
    to: o.to,
    subject: en ? 'Reset your LernQuest password' : 'Dein LernQuest-Passwort zurücksetzen',
    html: layout({
      title: en ? 'Reset your password' : 'Passwort zurücksetzen',
      preheader: en ? 'Choose a new password.' : 'Leg ein neues Passwort fest.',
      app: o.app,
      locale: o.locale,
      body: en ?
        h('Forgot your password?') +
        p(`No problem, ${esc(o.name)}. Use the button to set a new password for <strong>@${esc(o.username)}</strong>.`) +
        button(o.link, 'Set a new password') +
        small('This link is valid for one hour and can only be used once. If you did not request it, ignore this email; your password will not change.') :
        h('Passwort vergessen?') +
        p(`Kein Problem, ${esc(o.name)}. Mit dem Knopf legst du ein neues Passwort für <strong>@${esc(o.username)}</strong> fest.`) +
        button(o.link, 'Neues Passwort festlegen') +
        small('Der Link ist 1 Stunde gültig und funktioniert nur einmal. Du hast das nicht angefordert? Dann ignoriere diese Mail – dein Passwort bleibt unverändert.'),
    }),
    text: en ? `Hi ${o.name},\n\nSet a new password for @${o.username}:\n${o.link}\n\nThis link is valid for one hour and can only be used once. If you did not request it, ignore this email.\n\n— LernQuest · ${OWNER}` : `Hallo ${o.name},\n\nneues Passwort für @${o.username} festlegen:\n${o.link}\n\nDer Link ist 1 Stunde gültig. Nicht angefordert? Dann ignoriere diese Mail.\n\n— LernQuest · ${OWNER}`,
  };
}

// ---------- Newsletter ----------
export function optInMail(o: { to: string; name: string; link: string; app: string; locale?: Locale }): Mail {
  const en = o.locale === 'en';
  return {
    to: o.to,
    from: 'news',
    subject: en ? 'Confirm your newsletter subscription' : 'Bitte bestätige deine Newsletter-Anmeldung',
    html: layout({
      title: en ? 'Confirm newsletter subscription' : 'Newsletter bestätigen',
      preheader: en ? 'One more click to subscribe to the LernQuest newsletter.' : 'Nur noch ein Klick zum LernQuest-Newsletter.',
      app: o.app,
      locale: o.locale,
      body: en ?
        h('Almost there! 📬') +
        p(`Hi ${esc(o.name)}, you signed up for the LernQuest newsletter. Please confirm with one click; we will only send it after you confirm.`) +
        button(o.link, 'Subscribe to the newsletter') +
        small('This link is valid for 7 days. If this was not you, ignore this email; you will not be subscribed.') :
        h('Fast geschafft! 📬') +
        p(`Hallo ${esc(o.name)}, du hast dich für den LernQuest-Newsletter angemeldet. Bitte bestätige das mit einem Klick – erst dann schicken wir dir etwas.`) +
        button(o.link, 'Ja, Newsletter abonnieren') +
        small('Der Link ist 7 Tage gültig. Du warst das nicht? Dann ignoriere diese Mail, du wirst nicht eingetragen.'),
    }),
    text: en ? `Hi ${o.name},\n\nPlease confirm your LernQuest newsletter subscription:\n${o.link}\n\nIf this was not you, ignore this email.\n\n— LernQuest · ${OWNER}` : `Hallo ${o.name},\n\nbitte bestätige deine Anmeldung zum LernQuest-Newsletter:\n${o.link}\n\nDu warst das nicht? Dann ignoriere diese Mail.\n\n— LernQuest · ${OWNER}`,
  };
}

/** Newsletter-Ausgabe: Inhalt (fertiges HTML) + Footer mit Abmeldelink */
export function issueMail(o: { to: string; subject: string; contentHtml: string; contentText: string; unsubscribe: string; app: string; locale?: Locale }): Mail {
  const en = o.locale === 'en';
  return {
    to: o.to,
    from: 'news',
    subject: o.subject,
    headers: { 'List-Unsubscribe': `<${o.unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    html: layout({
      title: o.subject,
      preheader: o.contentText.replace(/\s+/g, ' ').slice(0, 120),
      app: o.app,
      locale: o.locale,
      body: `<div class="lq-news">${o.contentHtml}</div>`,
      footer: en ? `You are receiving this email because you confirmed your LernQuest newsletter subscription.<br><a href="${esc(o.unsubscribe)}" style="color:#7c5cff;font-weight:700">Unsubscribe</a> with one click.` : `Du bekommst diese Mail, weil du den LernQuest-Newsletter abonniert und bestätigt hast.<br><a href="${esc(o.unsubscribe)}" style="color:#7c5cff;font-weight:700">Newsletter abbestellen</a> – ein Klick genügt.`,
    }),
    text: en ? `${o.contentText}\n\n—\nYou are receiving this email because you subscribed to the LernQuest newsletter.\nUnsubscribe: ${o.unsubscribe}\n\nLernQuest · ${OWNER}` : `${o.contentText}\n\n—\nDu bekommst diese Mail, weil du den LernQuest-Newsletter abonniert hast.\nAbbestellen: ${o.unsubscribe}\n\nLernQuest · ${OWNER}`,
  };
}
