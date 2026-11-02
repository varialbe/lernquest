import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from '@lernquest/api/db';
import { adminNotifications } from '@lernquest/api/schema';
import { config } from './config.ts';
import type { Report } from './run.ts';

/** Benachrichtigungen: Telegram (nur sendMessage, kein Empfang). Ohne Token/Chat-ID oder bei Fehlern → Admin-Notification-Tabelle. */

type Level = 'info' | 'warn' | 'error';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function adminNote(level: Level, title: string, body: string) {
  getDb().insert(adminNotifications).values({ level, title, body }).run();
}

/** Sendet eine HTML-Nachricht an Telegram; fällt bei Bedarf auf die Admin-Tabelle zurück. Wirft nie. */
export async function notify(level: Level, title: string, htmlBody: string, plainBody = htmlBody.replace(/<[^>]+>/g, '')): Promise<'telegram' | 'admin'> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chat = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!token || !chat) {
    adminNote(level, title, `${plainBody}\n\n(Telegram nicht konfiguriert: TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID in .env fehlen)`);
    return 'admin';
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: `<b>${esc(title)}</b>\n${htmlBody}`.slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json()) as { ok: boolean; description?: string };
    if (!json.ok) throw new Error(json.description ?? `HTTP ${res.status}`);
    if (level !== 'info') adminNote(level, title, plainBody); // Warnungen/Fehler zusätzlich in der App sichtbar
    return 'telegram';
  } catch (e) {
    adminNote(level, title, `${plainBody}\n\n(Telegram-Versand fehlgeschlagen: ${(e as Error).message})`);
    return 'admin';
  }
}

const fmtDuration = (s: number) => (s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`);
const fmtNum = (n: number) => n.toLocaleString('de-DE');

/** Zusammenfassung eines Pipeline-Laufs als Telegram-Nachricht. */
export function runMessage(r: Report): { level: Level; title: string; html: string } {
  const failed = r.files.filter((f) => f.status === 'failed');
  const done = r.files.filter((f) => f.status === 'done');
  if (r.status === 'nothing_new') {
    return { level: 'info', title: '✅ LernQuest: nichts Neues', html: `Keine neuen Notizen · Studium @ <code>${r.studiumHead.slice(0, 8)}</code> · ${fmtDuration(r.durationSec)}` };
  }
  const icon = r.status === 'success' ? '✅' : r.status === 'partial' ? '⚠️' : '❌';
  const label = { success: 'erfolgreich', partial: 'teilweise fehlgeschlagen', failed: 'fehlgeschlagen', nothing_new: '' }[r.status];
  const lines: string[] = [];
  if (r.rateLimited) lines.push('🚦 <b>Codex-Rate-Limit erreicht</b> – restliche Dateien werden im nächsten Lauf versucht.');
  lines.push(`Modus <code>${r.mode}</code> · Dauer ${fmtDuration(r.durationSec)} · Tokens ${fmtNum(r.totals.tokens)}`);
  const units = done.filter((f) => f.questions);
  const wissen = done.filter((f) => !f.questions && f.knowledge);
  if (units.length || !wissen.length) lines.push(`📚 ${units.length} Notizen → ${r.totals.levels} Level, ${r.totals.questions} Fragen`);
  for (const f of units) {
    lines.push(`  • ${esc(f.unitId ?? '')} <b>${esc(f.title ?? '')}</b> (${f.questions} Fragen${f.knowledge ? `, 📖 ${f.knowledge} Begriffe` : ''}${f.notes?.length ? `, ⚑ ${f.notes.length} Hinweise` : ''})`);
  }
  if (wissen.length) {
    lines.push(`📖 Wissenssammlung für ${wissen.length} Unit(s):`);
    for (const f of wissen) lines.push(`  • ${esc(f.unitId ?? '')} ${esc((f.title ?? '').replace(/ \(Wissen\)$/, ''))} – ${f.knowledge} Begriffe`);
  }
  if (failed.length) {
    lines.push(`❌ ${failed.length} fehlgeschlagen:`);
    for (const f of failed) lines.push(`  • ${esc(f.path.split('/').pop() ?? f.path)}: ${esc((f.error ?? '').split('\n')[0]!.slice(0, 160))}`);
  }
  for (const w of r.warnings.filter((w) => !w.startsWith('Erster Lauf'))) lines.push(`⚠️ ${esc(w.slice(0, 200))}`);
  return { level: r.status === 'success' ? 'info' : r.status === 'partial' ? 'warn' : 'error', title: `${icon} LernQuest-Pipeline ${label}`, html: lines.join('\n') };
}

/**
 * Einmalige Einrichtung: liest die Chat-ID aus dem letzten /start an den Bot (getUpdates) und trägt sie in .env ein.
 * Danach empfängt die App nie wieder etwas von Telegram.
 */
export async function telegramSetup(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN fehlt in .env');
  const res = (await (await fetch(`https://api.telegram.org/bot${token}/getUpdates`)).json()) as {
    result: { message?: { chat: { id: number; type: string; first_name?: string; title?: string } } }[];
  };
  const chats = res.result.map((u) => u.message?.chat).filter((c): c is NonNullable<typeof c> => !!c);
  const chat = chats.at(-1);
  if (!chat) throw new Error('Keine Nachricht gefunden – schreibe dem Bot zuerst /start und starte den Befehl erneut.');
  const envPath = join(config.root, '.env');
  const env = readFileSync(envPath, 'utf8');
  const line = `TELEGRAM_CHAT_ID=${chat.id}`;
  writeFileSync(envPath, /^TELEGRAM_CHAT_ID=.*$/m.test(env) ? env.replace(/^TELEGRAM_CHAT_ID=.*$/m, line) : `${env.trimEnd()}\n${line}\n`);
  process.env.TELEGRAM_CHAT_ID = String(chat.id);
  console.log(`Chat-ID ${chat.id} (${chat.first_name ?? chat.title ?? chat.type}) in .env gespeichert.`);
  const via = await notify('info', '🔔 LernQuest-Benachrichtigungen aktiv', 'Ab jetzt bekommst du hier nach jedem nächtlichen Lauf eine Zusammenfassung.');
  console.log(via === 'telegram' ? 'Testnachricht gesendet.' : 'Testnachricht fehlgeschlagen – siehe Admin-Notifications.');
}
