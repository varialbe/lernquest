import { eq } from 'drizzle-orm';
import { marked } from 'marked';
import type { DB } from '../db/index.ts';
import { newsletterIssues } from '../db/schema.ts';
import { confirmedSubscribers, unsubscribeUrl } from './account.ts';
import { decrypt } from './crypto.ts';
import { appUrl, issueMail, layout, sendMail } from './mail.ts';

export type Issue = typeof newsletterIssues.$inferSelect;
export type Format = Issue['format'];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Inline-Styles für Mail-Clients (viele ignorieren <style>) */
function styleContent(html: string) {
  const st: Record<string, string> = {
    h1: 'margin:0 0 14px;font-size:24px;line-height:1.25;font-weight:900;color:#241d3d',
    h2: 'margin:22px 0 10px;font-size:19px;line-height:1.3;font-weight:800;color:#241d3d',
    h3: 'margin:18px 0 8px;font-size:16px;font-weight:800;color:#241d3d',
    p: 'margin:0 0 12px',
    ul: 'margin:0 0 12px;padding-left:22px',
    ol: 'margin:0 0 12px;padding-left:22px',
    li: 'margin:0 0 4px',
    blockquote: 'margin:0 0 12px;padding:10px 14px;border-left:4px solid #7c5cff;background:#f1eefc;border-radius:8px',
    pre: 'margin:0 0 12px;padding:12px;background:#f1eefc;border-radius:10px;overflow:auto;font-size:13px',
    code: 'font-family:ui-monospace,Menlo,Consolas,monospace;background:#f1eefc;padding:1px 4px;border-radius:4px',
    hr: 'border:none;border-top:2px solid #e4def7;margin:20px 0',
    img: 'max-width:100%;height:auto;border-radius:12px',
    a: 'color:#7c5cff;font-weight:700',
    table: 'border-collapse:collapse;margin:0 0 12px',
    td: 'border:1px solid #e4def7;padding:6px 10px',
    th: 'border:1px solid #e4def7;padding:6px 10px;background:#f1eefc',
  };
  return html.replace(/<(h1|h2|h3|p|ul|ol|li|blockquote|pre|code|hr|img|a|table|td|th)(\s[^>]*)?>/gi, (m, tag: string, attrs = '') =>
    /\sstyle=/i.test(attrs) ? m : `<${tag}${attrs} style="${st[tag.toLowerCase()]}">`.replace(' style="" ', ' '),
  );
}

/** Quelle → { html (Inhalt ohne Rahmen), text } */
export function render(format: Format, source: string): { html: string; text: string } {
  let html: string;
  if (format === 'html') {
    // vollständige Dokumente: nur den <body>-Inhalt übernehmen
    const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(source);
    html = (body ? body[1]! : source).replace(/<script[\s\S]*?<\/script>/gi, '');
  } else if (format === 'md') {
    html = marked.parse(source, { async: false, gfm: true, breaks: true }) as string;
  } else {
    html = source
      .trim()
      .split(/\n{2,}/)
      .map((para) => `<p>${esc(para).replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</p>`)
      .join('\n');
  }
  const text =
    format === 'txt'
      ? source.trim()
      : html
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/(p|h\d|li|blockquote|pre|tr)>/gi, '\n\n')
          .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
  return { html: styleContent(html), text };
}

/** Komplette Mail als HTML-Datei (Vorschau im Bot) */
export function previewHtml(issue: Issue) {
  const { html, text } = render(issue.format, issue.source);
  return issueMail({ to: 'vorschau@example.org', subject: issue.subject, contentHtml: html, contentText: text, unsubscribe: `${appUrl()}/#abmelden-vorschau`, app: appUrl() }).html;
}

export async function sendTest(issue: Issue, to: string) {
  const { html, text } = render(issue.format, issue.source);
  await sendMail(issueMail({ to, subject: `[Test] ${issue.subject}`, contentHtml: html, contentText: text, unsubscribe: `${appUrl()}/profile`, app: appUrl() }));
}

/** An alle bestätigten Abonnenten senden (gedrosselt). Gibt {sent, failed} zurück. */
export async function sendIssue(db: DB, issue: Issue, onProgress?: (done: number, total: number) => void) {
  const subs = confirmedSubscribers(db);
  const { html, text } = render(issue.format, issue.source);
  db.update(newsletterIssues).set({ status: 'sending', recipients: subs.length }).where(eq(newsletterIssues.id, issue.id)).run();
  let failed = 0;
  for (const [i, s] of subs.entries()) {
    const to = decrypt(s.emailEnc);
    try {
      if (!to) throw new Error('keine Adresse');
      await sendMail(issueMail({ to, subject: issue.subject, contentHtml: html, contentText: text, unsubscribe: unsubscribeUrl(s.id), app: appUrl() }));
    } catch {
      failed++;
    }
    if ((i + 1) % 10 === 0) onProgress?.(i + 1, subs.length);
    await new Promise((r) => setTimeout(r, process.env.VITEST ? 0 : 250));
  }
  db.update(newsletterIssues).set({ status: 'sent', sentAt: Date.now(), failed }).where(eq(newsletterIssues.id, issue.id)).run();
  return { sent: subs.length - failed, failed, total: subs.length };
}

export { layout };
