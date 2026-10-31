/**
 * Telegram-Bot für den Newsletter (Dienst lernquest-bot, Long-Polling – kein Webhook, kein offener Port).
 * Reagiert ausschließlich auf den Admin-Chat (TELEGRAM_CHAT_ID).
 *
 *   /newsletter new <Betreff>     neuen Entwurf anlegen, danach Inhalt schicken (Text = Markdown, oder Datei .md/.html/.txt)
 *   /newsletter draft [id]        aktuellen Entwurf zeigen bzw. Entwurf <id> auswählen
 *   /newsletter subject <Betreff> Betreff ändern
 *   /newsletter test              Testmail an NEWSLETTER_TEST_TO + HTML-Vorschau hier im Chat
 *   /newsletter send              an alle bestätigten Abonnenten senden (mit Rückfrage)
 *   /newsletter overview          Abonnenten, Entwürfe, versendete Ausgaben
 *   /newsletter delete [id]       Entwurf löschen
 */
import './env.ts';
import { desc, eq } from 'drizzle-orm';
import { getDb } from './db/index.ts';
import { newsletterIssues, pipelineState } from './db/schema.ts';
import { subscriberCounts } from './lib/account.ts';
import { previewHtml, render, sendIssue, sendTest, type Format, type Issue } from './lib/newsletter.ts';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? '';
const ADMIN_CHAT = process.env.TELEGRAM_CHAT_ID?.trim() ?? '';
const TEST_TO = process.env.NEWSLETTER_TEST_TO?.trim() || 'varialbe@varialbe.xyz';
const API = `https://api.telegram.org/bot${TOKEN}`;
const db = getDb();

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

async function tg<T = unknown>(method: string, body: Record<string, unknown> | FormData, timeoutMs = 20_000): Promise<T> {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    ...(body instanceof FormData ? { body } : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = (await res.json()) as { ok: boolean; result: T; description?: string };
  if (!json.ok) throw new Error(`${method}: ${json.description}`);
  return json.result;
}
const say = (text: string, extra: Record<string, unknown> = {}) => tg('sendMessage', { chat_id: ADMIN_CHAT, text: text.slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true, ...extra });

// ---------- Zustand (in pipeline_state: aktiver Entwurf, Update-Offset) ----------
const getKV = (k: string) => db.select().from(pipelineState).where(eq(pipelineState.key, k)).get()?.value ?? null;
const setKV = (k: string, v: string) => db.insert(pipelineState).values({ key: k, value: v }).onConflictDoUpdate({ target: pipelineState.key, set: { value: v, updatedAt: Date.now() } }).run();
const issueById = (id: number) => db.select().from(newsletterIssues).where(eq(newsletterIssues.id, id)).get();
function activeDraft(): Issue | undefined {
  const id = Number(getKV('bot.draft'));
  const i = id ? issueById(id) : undefined;
  return i?.status === 'draft' ? i : undefined;
}

const HELP = `<b>📬 Newsletter-Befehle</b>
/newsletter new &lt;Betreff&gt; – neuer Entwurf
/newsletter draft [id] – Entwurf zeigen/auswählen
/newsletter subject &lt;Betreff&gt; – Betreff ändern
/newsletter test – Testmail an ${esc(TEST_TO)} + Vorschau
/newsletter send – an alle Abonnenten senden
/newsletter overview – Übersicht
/newsletter delete [id] – Entwurf löschen

Inhalt: nach <code>new</code> einfach eine Nachricht schicken (Markdown) oder eine Datei <b>.md</b>, <b>.html</b> oder <b>.txt</b> hochladen. Absender: news.quest@varialbe.xyz, Footer mit Abmeldelink kommt automatisch dazu.`;

function describe(i: Issue) {
  const { text } = render(i.format, i.source);
  const preview = text ? esc(text.slice(0, 500)) + (text.length > 500 ? ' …' : '') : '<i>(noch kein Inhalt – schick mir Text oder eine Datei)</i>';
  return `<b>Entwurf #${i.id}</b>: ${esc(i.subject)}\nFormat: ${i.format.toUpperCase()} · ${i.source.length.toLocaleString('de-DE')} Zeichen\n\n${preview}`;
}

async function handleCommand(text: string) {
  const [, sub = 'help', ...rest] = text.trim().split(/\s+/);
  const arg = text.trim().split(/\s+/).slice(2).join(' ').trim();
  switch (sub.toLowerCase()) {
    case 'new': {
      if (!arg) return say('Bitte mit Betreff: <code>/newsletter new Neue Level für ERA</code>');
      const i = db.insert(newsletterIssues).values({ subject: arg.slice(0, 200), format: 'md', source: '' }).returning().get();
      setKV('bot.draft', String(i.id));
      return say(`✏️ Entwurf <b>#${i.id}</b> angelegt: ${esc(i.subject)}\n\nSchick mir jetzt den Inhalt – als Nachricht (Markdown) oder als Datei (.md/.html/.txt).`);
    }
    case 'draft': {
      if (rest[0] && /^\d+$/.test(rest[0])) {
        const i = issueById(Number(rest[0]));
        if (!i || i.status !== 'draft') return say(`Kein Entwurf #${esc(rest[0])}.`);
        setKV('bot.draft', String(i.id));
        return say(`Aktiver Entwurf ist jetzt #${i.id}.\n\n${describe(i)}`);
      }
      const i = activeDraft();
      const others = db.select().from(newsletterIssues).where(eq(newsletterIssues.status, 'draft')).orderBy(desc(newsletterIssues.id)).all().filter((x) => x.id !== i?.id);
      const list = others.length ? `\n\nWeitere Entwürfe: ${others.map((x) => `#${x.id} ${esc(x.subject)}`).join(' · ')}\n(<code>/newsletter draft &lt;id&gt;</code> zum Wechseln)` : '';
      return say((i ? describe(i) : 'Kein aktiver Entwurf. Leg einen an: <code>/newsletter new &lt;Betreff&gt;</code>') + list);
    }
    case 'subject': {
      const i = activeDraft();
      if (!i) return say('Kein aktiver Entwurf.');
      if (!arg) return say('Bitte mit neuem Betreff.');
      db.update(newsletterIssues).set({ subject: arg.slice(0, 200) }).where(eq(newsletterIssues.id, i.id)).run();
      return say(`Betreff von #${i.id}: ${esc(arg)}`);
    }
    case 'test': {
      const i = activeDraft();
      if (!i?.source) return say('Kein Entwurf mit Inhalt.');
      await sendTest(i, TEST_TO);
      const fd = new FormData();
      fd.set('chat_id', ADMIN_CHAT);
      fd.set('caption', `Vorschau #${i.id} – Testmail ging an ${TEST_TO}`);
      fd.set('document', new Blob([previewHtml(i)], { type: 'text/html' }), `newsletter-${i.id}-vorschau.html`);
      await tg('sendDocument', fd);
      return;
    }
    case 'send': {
      const i = activeDraft();
      if (!i?.source) return say('Kein Entwurf mit Inhalt.');
      const { confirmed } = subscriberCounts(db);
      if (!confirmed) return say('Es gibt noch keine bestätigten Abonnenten.');
      return say(`Wirklich senden?\n\n<b>#${i.id}</b> ${esc(i.subject)}\nan <b>${confirmed}</b> bestätigte Abonnenten von news.quest@varialbe.xyz`, {
        reply_markup: { inline_keyboard: [[{ text: `✅ Jetzt an ${confirmed} senden`, callback_data: `send:${i.id}` }, { text: 'Abbrechen', callback_data: 'cancel' }]] },
      });
    }
    case 'overview': {
      const c = subscriberCounts(db);
      const drafts = db.select().from(newsletterIssues).where(eq(newsletterIssues.status, 'draft')).orderBy(desc(newsletterIssues.id)).all();
      const sent = db.select().from(newsletterIssues).where(eq(newsletterIssues.status, 'sent')).orderBy(desc(newsletterIssues.sentAt)).limit(8).all();
      const d = (ms: number | null) => (ms ? new Date(ms).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short' }) : '–');
      return say(
        [
          '<b>📊 Newsletter-Übersicht</b>',
          `Abonnenten: <b>${c.confirmed ?? 0}</b> bestätigt · ${c.pending ?? 0} warten auf Bestätigung`,
          '',
          `<b>Entwürfe</b> (${drafts.length})${activeDraft() ? ` – aktiv: #${activeDraft()!.id}` : ''}`,
          ...(drafts.length ? drafts.map((x) => `#${x.id} ${esc(x.subject)} · ${x.format.toUpperCase()}`) : ['–']),
          '',
          '<b>Versendet</b>',
          ...(sent.length ? sent.map((x) => `#${x.id} ${esc(x.subject)} · ${d(x.sentAt)} · ${x.recipients - x.failed}/${x.recipients} zugestellt`) : ['–']),
        ].join('\n'),
      );
    }
    case 'delete': {
      const i = rest[0] && /^\d+$/.test(rest[0]) ? issueById(Number(rest[0])) : activeDraft();
      if (!i || i.status !== 'draft') return say('Kein Entwurf zum Löschen.');
      db.delete(newsletterIssues).where(eq(newsletterIssues.id, i.id)).run();
      return say(`🗑 Entwurf #${i.id} gelöscht.`);
    }
    default:
      return say(HELP);
  }
}

const FORMAT_OF: Record<string, Format> = { md: 'md', markdown: 'md', html: 'html', htm: 'html', txt: 'txt', text: 'txt' };

async function setContent(source: string, format: Format, label: string) {
  const i = activeDraft();
  if (!i) return say('Kein aktiver Entwurf. Erst <code>/newsletter new &lt;Betreff&gt;</code>.');
  db.update(newsletterIssues).set({ source, format }).where(eq(newsletterIssues.id, i.id)).run();
  return say(`📄 Inhalt für #${i.id} übernommen (${label}).\n\n${describe(issueById(i.id)!)}\n\nWeiter: /newsletter test oder /newsletter send`);
}

type Update = {
  update_id: number;
  message?: { chat: { id: number }; text?: string; caption?: string; document?: { file_id: string; file_name?: string; file_size?: number } };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number }; message_id: number } };
};

async function handle(u: Update) {
  if (u.callback_query) {
    const q = u.callback_query;
    if (String(q.message?.chat.id) !== ADMIN_CHAT) return;
    await tg('answerCallbackQuery', { callback_query_id: q.id });
    if (q.message) await tg('editMessageReplyMarkup', { chat_id: ADMIN_CHAT, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
    if (q.data === 'cancel') return say('Abgebrochen.');
    const m = /^send:(\d+)$/.exec(q.data ?? '');
    if (!m) return;
    const i = issueById(Number(m[1]));
    if (!i || i.status !== 'draft') return say('Dieser Entwurf wurde schon versendet oder gelöscht.');
    await say(`🚀 Sende #${i.id} …`);
    const r = await sendIssue(db, i, (done, total) => void say(`… ${done}/${total}`).catch(() => {}));
    if (getKV('bot.draft') === String(i.id)) setKV('bot.draft', '');
    return say(`✅ <b>#${i.id} versendet</b>: ${r.sent}/${r.total} zugestellt${r.failed ? `, ${r.failed} fehlgeschlagen` : ''}.`);
  }
  const msg = u.message;
  if (!msg || String(msg.chat.id) !== ADMIN_CHAT) return; // fremde Chats ignorieren
  if (msg.document) {
    const name = msg.document.file_name ?? 'datei';
    const fmt = FORMAT_OF[name.split('.').pop()?.toLowerCase() ?? ''];
    if (!fmt) return say('Bitte eine .md-, .html- oder .txt-Datei schicken.');
    if ((msg.document.file_size ?? 0) > 1_000_000) return say('Datei zu groß (max. 1 MB).');
    const f = await tg<{ file_path: string }>('getFile', { file_id: msg.document.file_id });
    const res = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${f.file_path}`, { signal: AbortSignal.timeout(20_000) });
    const source = await res.text();
    if (msg.caption?.trim() && activeDraft()) db.update(newsletterIssues).set({ subject: msg.caption.trim().slice(0, 200) }).where(eq(newsletterIssues.id, activeDraft()!.id)).run();
    return setContent(source, fmt, `Datei ${esc(name)}`);
  }
  const text = msg.text ?? '';
  if (/^\/(newsletter|nl)(@\w+)?\b/i.test(text)) return handleCommand(text.replace(/^\/(newsletter|nl)(@\w+)?/i, '/newsletter'));
  if (/^\/(start|help)/i.test(text)) return say(HELP);
  if (text && !text.startsWith('/')) {
    if (!activeDraft()) return say('Kein aktiver Entwurf – leg einen an mit <code>/newsletter new &lt;Betreff&gt;</code>.');
    return setContent(text, 'md', 'Nachricht als Markdown');
  }
}

async function main() {
  if (!TOKEN || !ADMIN_CHAT) {
    log('TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID fehlen – Bot startet nicht.');
    process.exit(1);
  }
  await tg('setMyCommands', { commands: [{ command: 'newsletter', description: 'Newsletter: new, draft, test, send, overview' }, { command: 'help', description: 'Hilfe' }] }).catch((e) => log(e));
  log('Bot läuft (Long-Polling).');
  let offset = Number(getKV('bot.offset') ?? 0);
  for (;;) {
    try {
      const updates = await tg<Update[]>('getUpdates', { offset, timeout: 50, allowed_updates: ['message', 'callback_query'] }, 65_000);
      for (const u of updates) {
        offset = u.update_id + 1;
        setKV('bot.offset', String(offset));
        await handle(u).catch(async (e) => {
          log('Fehler', e);
          await say(`⚠️ Fehler: ${esc((e as Error).message)}`).catch(() => {});
        });
      }
    } catch (e) {
      log('getUpdates', (e as Error).message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

void main();
