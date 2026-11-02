/**
 * Telegram-Bot für Newsletter und Pipeline (Dienst lernquest-bot, Long-Polling – kein Webhook, kein offener Port).
 * Reagiert ausschließlich auf den Admin-Chat (TELEGRAM_CHAT_ID).
 *
 * Pipeline: 🔄 Neue Inhalte holen (= /fetch, /hol oder Text wie „hol die neuen Sachen“) startet sofort einen Lauf
 *   über den Trigger-Dienst (wie n8n um 00:00) und zeigt den Fortschritt live; 🔍 Was ist neu? (/neu) = Vorschau;
 *   📡 Status (/status) = laufender/letzte Läufe, dort auch 📖 Wissenssammlung nachholen.
 *
 * Bedienung über Buttons: /start (oder irgendeine Nachricht ohne offenen Schritt) zeigt das Menü.
 *   📝 Neuer Newsletter → Betreff schicken → Inhalt schicken (Text = Markdown, oder Datei .md/.html/.txt)
 *   Entwurf-Karte: Betreff ändern · Inhalt ersetzen · Testmail + Vorschau · Senden (mit Rückfrage) · Löschen
 *   📂 Entwürfe · 📊 Übersicht
 * Die alten Befehle (/newsletter new|draft|subject|test|send|overview|delete) funktionieren weiter als Abkürzung.
 */
import './env.ts';
import { desc, eq } from 'drizzle-orm';
import { getDb } from './db/index.ts';
import { newsletterIssues, pipelineState } from './db/schema.ts';
import { subscriberCounts } from './lib/account.ts';
import { previewHtml, render, sendIssue, sendTest, type Format, type Issue } from './lib/newsletter.ts';
import { FETCH_TEXT, MODE_LABEL, recentRuns, runningRunId, runProgress, runRow, STATUS_LABEL, triggerPipeline, type TriggerMode } from './lib/botPipeline.ts';

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

type Button = { text: string; callback_data: string };
type Keyboard = Button[][];
const btn = (text: string, data: string): Button => ({ text, callback_data: data });

/**
 * Antwortet: kommt die Aktion von einem Button, wird dessen Nachricht ersetzt (Chat bleibt aufgeräumt),
 * sonst eine neue Nachricht geschickt.
 */
async function show(text: string, keyboard: Keyboard = [], editId?: number) {
  const body = { chat_id: ADMIN_CHAT, text: text.slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: { inline_keyboard: keyboard } };
  if (editId) {
    try {
      return await tg('editMessageText', { ...body, message_id: editId });
    } catch (e) {
      if (/not modified/.test((e as Error).message)) return;
      // zu alt/gelöscht → neu schicken
    }
  }
  return tg('sendMessage', body);
}
const say = (text: string) => show(text);

// ---------- Zustand (in pipeline_state: aktiver Entwurf, offener Schritt, Update-Offset) ----------
const getKV = (k: string) => db.select().from(pipelineState).where(eq(pipelineState.key, k)).get()?.value ?? null;
const setKV = (k: string, v: string) => db.insert(pipelineState).values({ key: k, value: v }).onConflictDoUpdate({ target: pipelineState.key, set: { value: v, updatedAt: Date.now() } }).run();
const issueById = (id: number) => db.select().from(newsletterIssues).where(eq(newsletterIssues.id, id)).get();
const draftById = (id: number) => {
  const i = issueById(id);
  return i?.status === 'draft' ? i : undefined;
};
function activeDraft(): Issue | undefined {
  const id = Number(getKV('bot.draft'));
  return id ? draftById(id) : undefined;
}
const drafts = () => db.select().from(newsletterIssues).where(eq(newsletterIssues.status, 'draft')).orderBy(desc(newsletterIssues.id)).all();

/** Worauf der Bot gerade wartet: Betreff für neuen Entwurf, neuer Betreff, Inhalt */
type Await = { kind: 'new' } | { kind: 'subject' | 'content'; id: number };
const getAwait = (): Await | null => {
  try {
    return JSON.parse(getKV('bot.await') ?? 'null') as Await | null;
  } catch {
    return null;
  }
};
const setAwait = (a: Await | null) => setKV('bot.await', JSON.stringify(a));

// ---------- Bildschirme ----------
const MENU: Keyboard = [
  [btn('🔄 Neue Inhalte holen', 'fetch')],
  [btn('🔍 Was ist neu?', 'dry'), btn('📡 Status', 'status')],
  [btn('📝 Neuer Newsletter', 'new'), btn('📂 Entwürfe', 'drafts')],
  [btn('📊 Übersicht', 'overview'), btn('❓ Hilfe', 'help')],
];
const back = (to = 'menu', label = '⬅️ Menü') => [btn(label, to)];

function menu(editId?: number) {
  setAwait(null);
  const c = subscriberCounts(db);
  const n = drafts().length;
  return show(`<b>🤖 LernQuest</b>\n📬 Newsletter: ${c.confirmed ?? 0} Abonnenten · ${n} ${n === 1 ? 'Entwurf' : 'Entwürfe'}\n🔄 Neue Vorlesungen holen: sofort per Button, sonst automatisch um 00:00\n\nWas möchtest du tun?`, MENU, editId);
}

const HELP = `<b>❓ So geht’s</b>
<b>Neue Inhalte</b>
• <b>🔄 Neue Inhalte holen</b> (oder /fetch, /hol, oder einfach „hol die neuen Sachen“): startet sofort den Lauf, der sonst um 00:00 kommt – neue Mitschriften aus dem Studium-Repo → Codex erzeugt Level, Praxis und Wissenssammlung. Ich zeige den Fortschritt hier live, am Ende kommt die Zusammenfassung.
• <b>🔍 Was ist neu?</b> (/neu): nur nachsehen, was verarbeitet würde
• <b>📡 Status</b> (/status): laufender und letzte Läufe, Wissenssammlung nachholen

<b>Newsletter</b>
1. <b>📝 Neuer Newsletter</b> → Betreff schicken
2. Inhalt schicken: einfach als Nachricht (Markdown: <code>**fett**</code>, <code># Überschrift</code>, Links) oder als Datei <b>.md</b>, <b>.html</b>, <b>.txt</b>
3. <b>🧪 Testmail</b> → geht an ${esc(TEST_TO)}, die HTML-Vorschau kommt hier in den Chat
4. <b>🚀 Senden</b> → mit Rückfrage an alle bestätigten Abonnenten

Absender ist news.quest@varialbe.xyz. Footer mit Abmeldelink, Impressum und Datenschutz kommt automatisch dazu.`;

function draftCard(i: Issue, editId?: number, note = '') {
  setKV('bot.draft', String(i.id));
  const { text } = render(i.format, i.source);
  const preview = text ? esc(text.slice(0, 600)) + (text.length > 600 ? ' …' : '') : '<i>(noch kein Inhalt)</i>';
  const head = `${note ? `${note}\n\n` : ''}<b>✉️ Entwurf #${i.id}</b>\n<b>Betreff:</b> ${esc(i.subject)}\n<b>Format:</b> ${i.format.toUpperCase()} · ${i.source.length.toLocaleString('de-DE')} Zeichen\n\n${preview}`;
  const kb: Keyboard = [
    [btn('✏️ Betreff', `subj:${i.id}`), btn(i.source ? '📄 Inhalt ersetzen' : '📄 Inhalt schicken', `content:${i.id}`)],
    ...(i.source ? [[btn('🧪 Testmail + Vorschau', `test:${i.id}`), btn('🚀 Senden', `send:${i.id}`)]] : []),
    [btn('🗑 Löschen', `del:${i.id}`), btn('⬅️ Menü', 'menu')],
  ];
  return show(head, kb, editId);
}

function draftList(editId?: number) {
  const list = drafts();
  if (!list.length) return show('📂 Keine Entwürfe.', [[btn('📝 Neuer Newsletter', 'new')], back()], editId);
  return show(
    '<b>📂 Entwürfe</b> – tippe einen an:',
    [...list.slice(0, 20).map((x) => [btn(`#${x.id} ${x.subject}`.slice(0, 60), `open:${x.id}`)]), back()],
    editId,
  );
}

function overview(editId?: number) {
  const c = subscriberCounts(db);
  const ds = drafts();
  const sent = db.select().from(newsletterIssues).where(eq(newsletterIssues.status, 'sent')).orderBy(desc(newsletterIssues.sentAt)).limit(8).all();
  const d = (ms: number | null) => (ms ? new Date(ms).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short' }) : '–');
  return show(
    [
      '<b>📊 Übersicht</b>',
      `Abonnenten: <b>${c.confirmed ?? 0}</b> bestätigt · ${c.pending ?? 0} warten auf Bestätigung`,
      '',
      `<b>Entwürfe</b> (${ds.length})`,
      ...(ds.length ? ds.map((x) => `#${x.id} ${esc(x.subject)} · ${x.format.toUpperCase()}`) : ['–']),
      '',
      '<b>Versendet</b>',
      ...(sent.length ? sent.map((x) => `#${x.id} ${esc(x.subject)} · ${d(x.sentAt)} · ${x.recipients - x.failed}/${x.recipients} zugestellt`) : ['–']),
    ].join('\n'),
    [[btn('📂 Entwürfe', 'drafts'), btn('⬅️ Menü', 'menu')]],
    editId,
  );
}

function createDraft(subject: string) {
  const i = db.insert(newsletterIssues).values({ subject: subject.slice(0, 200), format: 'md', source: '' }).returning().get();
  setKV('bot.draft', String(i.id));
  setAwait({ kind: 'content', id: i.id });
  return show(`✏️ Entwurf <b>#${i.id}</b>: ${esc(i.subject)}\n\nSchick mir jetzt den <b>Inhalt</b> – als Nachricht (Markdown) oder als Datei (.md/.html/.txt).`, [[btn('Abbrechen', `open:${i.id}`)]]);
}

async function testDraft(i: Issue) {
  await sendTest(i, TEST_TO);
  const fd = new FormData();
  fd.set('chat_id', ADMIN_CHAT);
  fd.set('caption', `Vorschau #${i.id} – Testmail ging an ${TEST_TO}`);
  fd.set('document', new Blob([previewHtml(i)], { type: 'text/html' }), `newsletter-${i.id}-vorschau.html`);
  await tg('sendDocument', fd);
  return draftCard(i, undefined, '🧪 Testmail verschickt.');
}

function askSend(i: Issue, editId?: number) {
  const { confirmed } = subscriberCounts(db);
  if (!confirmed) return show('Es gibt noch keine bestätigten Abonnenten.', [[btn('⬅️ Zurück', `open:${i.id}`)]], editId);
  return show(`<b>Wirklich senden?</b>\n\n#${i.id} ${esc(i.subject)}\nan <b>${confirmed}</b> bestätigte Abonnenten von news.quest@varialbe.xyz`, [[btn(`✅ Jetzt an ${confirmed} senden`, `sendok:${i.id}`)], [btn('Abbrechen', `open:${i.id}`)]], editId);
}

async function doSend(i: Issue, editId?: number) {
  await show(`🚀 Sende #${i.id} …`, [], editId);
  const r = await sendIssue(db, i, (done, total) => void say(`… ${done}/${total}`).catch(() => {}));
  if (getKV('bot.draft') === String(i.id)) setKV('bot.draft', '');
  return show(`✅ <b>#${i.id} versendet</b>: ${r.sent}/${r.total} zugestellt${r.failed ? `, ${r.failed} fehlgeschlagen` : ''}.`, [back()]);
}

// ---------- Pipeline (neue Inhalte sofort holen) ----------
const fmtTime = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–');
const fmtDur = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
};
/** beobachtete Läufe: runId → Nachricht, die live aktualisiert wird */
const watching = new Map<string, { messageId: number; mode: TriggerMode; started: number }>();

function runCard(runId: string, mode: string, started: number): { text: string; done: boolean; kb: Keyboard } {
  const row = runRow(db, runId);
  const status = row?.status ?? 'running';
  const done = status !== 'running';
  const head = `<b>${done ? STATUS_LABEL[status] ?? status : '⏳ läuft'} · ${MODE_LABEL[mode] ?? mode}</b>\nRun <code>${esc(runId)}</code> · ${done && row?.finishedAt ? fmtDur(row.finishedAt - started) : `seit ${fmtDur(Date.now() - started)}`}`;
  let body: string;
  if (done && mode === 'dry-run') {
    // Vorschau schickt keine eigene Zusammenfassung → hier zeigen
    const planned = (row?.summary ?? '').split('\n').filter((l) => /^\s+[+✗⚠]/.test(l));
    body = planned.length ? `Würde verarbeiten:\n${planned.map((l) => esc(l.trim())).join('\n')}` : '✅ Nichts Neues im Studium-Repo.';
  } else if (done) {
    body = 'Fertig – die Zusammenfassung kommt als eigene Nachricht. Neue Units und Wissen sind sofort in App und Website.';
  } else {
    const lines = runProgress(runId);
    body = lines.length ? `<pre>${esc(lines.join('\n'))}</pre>` : 'Starte …';
  }
  const kb: Keyboard = done
    ? mode === 'dry-run' && /Würde/.test(body)
      ? [[btn('🔄 Jetzt holen', 'fetch')], back()]
      : [[btn('📡 Status', 'status'), btn('⬅️ Menü', 'menu')]]
    : [[btn('🔁 Aktualisieren', `watch:${runId}`)]];
  return { text: `${head}\n\n${body}`, done, kb };
}

async function startRun(mode: TriggerMode, editId?: number) {
  const r = await triggerPipeline(mode);
  if (!r.ok) {
    if (r.running) {
      const row = runRow(db, r.running);
      return watchRun(r.running, (row?.mode as TriggerMode) ?? 'run', row?.startedAt ?? Date.now(), editId, '⏳ Es läuft schon ein Lauf – ich zeige dir den:');
    }
    return show(`⚠️ ${esc(r.error)}`, [back()], editId);
  }
  return watchRun(r.runId, mode, Date.now(), editId);
}

async function watchRun(runId: string, mode: TriggerMode, started: number, editId?: number, note = '') {
  const c = runCard(runId, mode, started);
  const msg = (await show(`${note ? `${note}\n\n` : ''}${c.text}`, c.kb, editId)) as { message_id?: number } | undefined;
  const messageId = msg?.message_id ?? editId;
  if (!c.done && messageId) watching.set(runId, { messageId, mode, started });
}

/** alle 20 s: beobachtete Läufe im Chat aktualisieren */
async function tickWatchers() {
  for (const [runId, w] of watching) {
    const c = runCard(runId, w.mode, w.started);
    // nach 8 h aufgeben (Lauf hängt → meldet n8n/Watchdog)
    if (c.done || Date.now() - w.started > 8 * 3600_000) watching.delete(runId);
    // nur bearbeiten, nie neu senden (sonst alle 20 s eine neue Nachricht, falls das Bearbeiten scheitert)
    await tg('editMessageText', { chat_id: ADMIN_CHAT, message_id: w.messageId, text: c.text.slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: { inline_keyboard: c.kb } }).catch((e) => {
      if (!/not modified/.test((e as Error).message)) watching.delete(runId);
    });
  }
}

async function statusScreen(editId?: number) {
  const running = await runningRunId();
  if (running) {
    const row = runRow(db, running);
    return watchRun(running, (row?.mode as TriggerMode) ?? 'run', row?.startedAt ?? Date.now(), editId);
  }
  const runs = recentRuns(db);
  const lines = runs.map((r) => `${STATUS_LABEL[r.status] ?? r.status} · ${MODE_LABEL[r.mode] ?? r.mode} · ${fmtTime(r.startedAt)}${r.finishedAt ? ` · ${fmtDur(r.finishedAt - r.startedAt)}` : ''}`);
  return show(
    `<b>📡 Pipeline</b>\nGerade läuft nichts. Nächster automatischer Lauf: 00:00.\n\n<b>Letzte Läufe</b>\n${lines.join('\n') || '–'}`,
    [[btn('🔄 Neue Inhalte holen', 'fetch')], [btn('📖 Wissenssammlung nachholen', 'knowledge')], back()],
    editId,
  );
}

// ---------- Buttons ----------
async function onButton(data: string, editId: number) {
  const [action = '', idStr] = data.split(':');
  const id = Number(idStr);
  if (action === 'menu') return menu(editId);
  if (action === 'help') return show(HELP, [back()], editId);
  if (action === 'drafts') return draftList(editId);
  if (action === 'overview') return overview(editId);
  if (action === 'fetch') return startRun('run', editId);
  if (action === 'dry') return startRun('dry-run', editId);
  if (action === 'knowledge') return startRun('knowledge', editId);
  if (action === 'status') return statusScreen(editId);
  if (action === 'watch') {
    const row = runRow(db, idStr ?? '');
    return watchRun(idStr ?? '', (row?.mode as TriggerMode) ?? 'run', row?.startedAt ?? Date.now(), editId);
  }
  if (action === 'new') {
    setAwait({ kind: 'new' });
    return show('📝 Wie soll der <b>Betreff</b> lauten? Schick ihn mir als Nachricht.', [[btn('Abbrechen', 'menu')]], editId);
  }
  const i = draftById(id);
  if (!i) return show('Dieser Entwurf wurde schon versendet oder gelöscht.', [back()], editId);
  switch (action) {
    case 'open':
      setAwait(null);
      return draftCard(i, editId);
    case 'subj':
      setAwait({ kind: 'subject', id });
      return show(`✏️ Neuer Betreff für #${id}?\nAktuell: ${esc(i.subject)}`, [[btn('Abbrechen', `open:${id}`)]], editId);
    case 'content':
      setAwait({ kind: 'content', id });
      return show(`📄 Schick mir den Inhalt für #${id} – als Nachricht (Markdown) oder Datei (.md/.html/.txt).`, [[btn('Abbrechen', `open:${id}`)]], editId);
    case 'test':
      if (!i.source) return draftCard(i, editId, 'Erst Inhalt schicken.');
      await show(`🧪 Schicke Testmail an ${esc(TEST_TO)} …`, [], editId);
      return testDraft(i);
    case 'send':
      return askSend(i, editId);
    case 'sendok':
      return doSend(i, editId);
    case 'del':
      return show(`🗑 Entwurf #${id} „${esc(i.subject)}“ wirklich löschen?`, [[btn('Ja, löschen', `delok:${id}`), btn('Abbrechen', `open:${id}`)]], editId);
    case 'delok':
      db.delete(newsletterIssues).where(eq(newsletterIssues.id, id)).run();
      if (getKV('bot.draft') === String(id)) setKV('bot.draft', '');
      return show(`🗑 Entwurf #${id} gelöscht.`, [back()], editId);
  }
}

// ---------- Texte/Dateien ----------
const FORMAT_OF: Record<string, Format> = { md: 'md', markdown: 'md', html: 'html', htm: 'html', txt: 'txt', text: 'txt' };

function setContent(id: number, source: string, format: Format, label: string) {
  const i = draftById(id);
  if (!i) return say('Dieser Entwurf existiert nicht mehr.');
  db.update(newsletterIssues).set({ source, format }).where(eq(newsletterIssues.id, id)).run();
  setAwait(null);
  return draftCard(draftById(id)!, undefined, `📄 Inhalt übernommen (${label}).`);
}

/** Alte Slash-Befehle als Abkürzung */
async function handleCommand(text: string) {
  const parts = text.trim().split(/\s+/);
  const sub = (parts[1] ?? '').toLowerCase();
  const arg = parts.slice(2).join(' ').trim();
  const target = parts[2] && /^\d+$/.test(parts[2]) ? draftById(Number(parts[2])) : activeDraft();
  switch (sub) {
    case 'new':
      if (arg) return createDraft(arg);
      return onButton('new', 0);
    case 'draft':
      return target ? draftCard(target) : draftList();
    case 'subject':
      if (!target) return draftList();
      if (!arg) return onButton(`subj:${target.id}`, 0);
      db.update(newsletterIssues).set({ subject: arg.slice(0, 200) }).where(eq(newsletterIssues.id, target.id)).run();
      return draftCard(draftById(target.id)!, undefined, '✏️ Betreff geändert.');
    case 'test':
      return target?.source ? testDraft(target) : draftList();
    case 'send':
      return target?.source ? askSend(target) : draftList();
    case 'overview':
      return overview();
    case 'delete':
      return target ? onButton(`del:${target.id}`, 0) : draftList();
    default:
      return menu();
  }
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
    await tg('answerCallbackQuery', { callback_query_id: q.id }).catch(() => {});
    return onButton(q.data ?? 'menu', q.message?.message_id ?? 0);
  }
  const msg = u.message;
  if (!msg || String(msg.chat.id) !== ADMIN_CHAT) return; // fremde Chats ignorieren
  const waiting = getAwait();
  if (msg.document) {
    const name = msg.document.file_name ?? 'datei';
    const fmt = FORMAT_OF[name.split('.').pop()?.toLowerCase() ?? ''];
    if (!fmt) return say('Bitte eine .md-, .html- oder .txt-Datei schicken.');
    if ((msg.document.file_size ?? 0) > 1_000_000) return say('Datei zu groß (max. 1 MB).');
    const f = await tg<{ file_path: string }>('getFile', { file_id: msg.document.file_id });
    const res = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${f.file_path}`, { signal: AbortSignal.timeout(20_000) });
    const source = await res.text();
    // Datei ohne offenen Schritt → neuer Entwurf, Betreff aus Bildunterschrift oder Dateiname
    let id = waiting?.kind === 'content' ? waiting.id : 0;
    if (!id) {
      const subject = msg.caption?.trim() || name.replace(/\.[^.]+$/, '');
      id = db.insert(newsletterIssues).values({ subject: subject.slice(0, 200), format: fmt, source: '' }).returning().get().id;
    } else if (msg.caption?.trim()) {
      db.update(newsletterIssues).set({ subject: msg.caption.trim().slice(0, 200) }).where(eq(newsletterIssues.id, id)).run();
    }
    return setContent(id, source, fmt, `Datei ${esc(name)}`);
  }
  const text = msg.text ?? '';
  if (/^\/(newsletter|nl)(@\w+)?\b/i.test(text)) {
    setAwait(null);
    return handleCommand(text.replace(/^\/(newsletter|nl)(@\w+)?/i, '/newsletter'));
  }
  if (/^\/(fetch|hol|holen|update)(@\w+)?\b/i.test(text)) return startRun('run');
  if (/^\/(neu|dry)(@\w+)?\b/i.test(text)) return startRun('dry-run');
  if (/^\/(status|pipeline)(@\w+)?\b/i.test(text)) return statusScreen();
  if (/^\/(wissen|knowledge)(@\w+)?\b/i.test(text)) return startRun('knowledge');
  if (text.startsWith('/')) return menu(); // /start, /help, /menu …
  if (!text.trim()) return;
  if (waiting?.kind === 'new') return createDraft(text.trim());
  if (waiting?.kind === 'subject') {
    if (!draftById(waiting.id)) return menu();
    db.update(newsletterIssues).set({ subject: text.trim().slice(0, 200) }).where(eq(newsletterIssues.id, waiting.id)).run();
    setAwait(null);
    return draftCard(draftById(waiting.id)!, undefined, '✏️ Betreff geändert.');
  }
  if (waiting?.kind === 'content') return setContent(waiting.id, text, 'md', 'Nachricht als Markdown');
  if (FETCH_TEXT.test(text)) return startRun('run');
  return menu();
}

async function main() {
  if (!TOKEN || !ADMIN_CHAT) {
    log('TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID fehlen – Bot startet nicht.');
    process.exit(1);
  }
  await tg('setMyCommands', {
    commands: [
      { command: 'fetch', description: '🔄 Neue Inhalte jetzt holen' },
      { command: 'status', description: '📡 Pipeline-Status' },
      { command: 'neu', description: '🔍 Was ist neu? (Vorschau)' },
      { command: 'wissen', description: '📖 Wissenssammlung nachholen' },
      { command: 'start', description: 'Menü (Newsletter & Pipeline)' },
    ],
  }).catch((e) => log(e));
  setInterval(() => void tickWatchers().catch((e) => log('watch', e)), 20_000);
  await tg('setChatMenuButton', { chat_id: Number(ADMIN_CHAT), menu_button: { type: 'commands' } }).catch((e) => log(e));
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
