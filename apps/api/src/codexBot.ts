/**
 * Codex vom Handy steuern (Teil des Admin-Bots, reagiert also nur auf TELEGRAM_CHAT_ID).
 *
 * 🧠 Codex (/codex): Modell, Reasoning und Ordner wählen, dann die Aufgabe als Nachricht schicken.
 *   Schnell: /codex m=luna r=xhigh d=lernquest <Aufgabe>   (m/r/d optional, gelten nur für diesen Job)
 * 📚 Lehrer (/lehrer <Frage>): Codex mit dem Skill `lehrer` im Studium-Repo; Gespräch läuft weiter, bis /lehrer neu.
 * 📋 Jobs (/jobs): laufende und letzte Jobs, Stop.   📅 Artemis (/artemis): Hausaufgaben-Stand.
 * 📄 /md: alles aus Artemis als .md (artemis export: Überblick, Abgaben, Tests, Aufgabenstellungen).
 * 🎬 Video (/video [Idee]): Claude Code im Video-Studio (~/viral-videos, Skill viral-remotion-director) schlägt Ideen vor,
 *   produziert, schickt Updates per `tg` und das fertige Video; Antworten/Revision/Fertig gehen in dieselbe Claude-Sitzung.
 *   n8n stößt jeden Tag um 10:00 eine Idee an (POST 127.0.0.1:3462/video/idea, Bearer PIPELINE_TOKEN).
 * Nach einer Antwort: einfach weiterschreiben oder auf die Antwort antworten → derselbe Codex-Thread macht weiter.
 *
 * Jeder Job läuft als eigene systemd-User-Unit (codex-tg-<id>), nicht im Bot-Prozess: kein 300-MB-Limit des Bots,
 * kein NoNewPrivileges, und Jobs überleben einen Bot-Neustart. Ohne User-Manager (Linger aus) Fallback: losgelöster Prozess.
 * Codex läuft ohne Sandbox (bwrap geht auf dem VPS nicht) – die Sicherheitsgrenze ist der Admin-Chat.
 * Zustand: ~/.local/state/codex-tg/jobs/<id>/{meta.json,prompt.txt,events.jsonl,stderr.log,last.txt,exit}
 */
import { execFile, execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type Button = { text: string; callback_data: string };
type Keyboard = Button[][];
export type Ctx = {
  show: (text: string, kb?: Keyboard, editId?: number) => Promise<unknown>;
  tg: <T = unknown>(method: string, body: Record<string, unknown> | FormData, timeoutMs?: number) => Promise<T>;
  getKV: (k: string) => string | null;
  setKV: (k: string, v: string) => void;
  chat: string;
};

const HOME = os.homedir();
const ROOT = path.join(HOME, '.local/state/codex-tg/jobs');
const CODEX = process.env.CODEX_BIN || path.join(HOME, '.local/bin/codex');
const ARTEMIS = path.join(HOME, '.local/bin/artemis');
const MODELS_CACHE = path.join(HOME, '.codex/models_cache.json');
const STUDIUM = process.env.STUDIUM_REPO || path.join(HOME, 'studium');
const UID = process.getuid?.() ?? 1000;
const JOB_ENV = {
  ...process.env,
  XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || `/run/user/${UID}`,
  DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS || `unix:path=/run/user/${UID}/bus`,
};
const PATH_ENV = `${HOME}/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`;
const DEFAULTS: Settings = { model: 'gpt-6.1-sol', effort: 'medium', cwd: HOME };
const DIR_PRESETS: [string, string][] = [
  ['🏠 Home', HOME],
  ['📚 Studium', STUDIUM],
  ['🎮 LernQuest', path.join(HOME, 'lernquest')],
  ['🧰 apps', path.join(HOME, 'apps')],
];
const LEHRER_PREFIX = `Nutze den Skill \`lehrer\` (~/.codex/skills/lehrer/SKILL.md) und halte dich strikt daran. Kontext: Telegram – kurze Nachrichten, kein LaTeX, kein Mermaid. Ändere nichts im Studium-Repo.\n\nIch: `;

// ---------- Video-Studio (Claude Code + Skill viral-remotion-director, Rendern auf dem VPS) ----------
const CLAUDE = process.env.CLAUDE_BIN || path.join(HOME, '.local/bin/claude');
const VIDEO_DIR = process.env.VIDEO_STUDIO || path.join(HOME, 'viral-videos');
const VIDEO_MODEL = process.env.VIDEO_MODEL || 'opus';
const VIDEO_RULES = `Du bist mein Video-Produzent für die TikTok-Cartoon-Serie. Arbeitsordner: ${VIDEO_DIR} (Studio unter studio/, Projekte unter projects/, fertige Videos unter out/).
Regeln:
- Nutze den Skill \`viral-remotion-director\` und alle Serienregeln darin (learnings.md, Asset-Bibliothek, Audio-Pipeline, visueller Stil). Assets wiederverwenden und erweitern.
- Stimmen, Musik und Isolator über die ElevenLabs-Tools (ToolSearch "ElevenLabs"). Gerendert wird HIER auf dem VPS (npx remotion render im studio/), nie in der Cloud.
- Ich bin am Handy auf Telegram. Schick mir Zwischenstände mit dem Befehl \`tg\` (liegt in ${VIDEO_DIR}/bin, im PATH):
  tg msg "Text" · tg photo bild.png "Caption" · tg audio take.mp3 "Caption" · tg video datei.mp4 "Caption" (komprimiert automatisch für Telegram) · tg doc datei "Caption"
  Updates an sinnvollen Stellen, z. B. Skript fertig (Text schicken), Stimmen gewählt, Kontaktbogen/Vorschau, fertiges Video. Nicht spammen: etwa 3–6 Updates pro Video.
- Fertiges Video: neue Versionsnummer (out/<slug>-vN.mp4, nie überschreiben) und per \`tg video\` schicken.
- Brauchst du eine Entscheidung von mir (z. B. Stimmwahl): Optionen per tg schicken, die Frage als letzte Antwort stellen und aufhören. Ich antworte per Telegram, dann geht es in dieser Sitzung weiter.
- Deine letzte Antwort ist kurz (Telegram): was du gemacht hast und was als Nächstes kommt. Kein LaTeX.`;
const VIDEO_IDEA_PROMPT = `${VIDEO_RULES}

Aufgabe jetzt: Schlag mir genau EINE neue Video-Idee vor. Schau dir dafür learnings.md, die bisherigen Videos (projects/) und was gut lief an. Format: Titel, Hook (erste 2 Sekunden), Ablauf in 4–6 Stichpunkten, warum das funktioniert, welche vorhandenen Assets du nutzt. Noch nichts bauen – warte auf meine Antwort.`;

type Settings = { model: string; effort: string; cwd: string };
type Meta = Settings & {
  id: string;
  prompt: string;
  started: number;
  threadId?: string;
  parent?: string;
  lehrer?: boolean;
  engine?: 'codex' | 'claude';
  video?: 'idea' | 'produce';
  runner: 'systemd' | 'spawn';
  unit?: string;
  pid?: number;
  messageId?: number;
};
type Await = { kind: 'prompt' } | { kind: 'lehrer' } | { kind: 'video' } | { kind: 'cwd' } | { kind: 'continue'; id: string } | null;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const btn = (text: string, data: string): Button => ({ text, callback_data: `cx:${data}`.slice(0, 64) });
const tilde = (p: string) => (p.startsWith(HOME) ? `~${p.slice(HOME.length)}` : p);
const untilde = (p: string) => path.resolve(p.replace(/^~(?=\/|$)/, HOME));
const fmtDur = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min` : s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
};
const log = (...a: unknown[]) => console.log(new Date().toISOString(), '[codex]', ...a);

export function createCodexBot(ctx: Ctx) {
  // ---------------- Einstellungen ----------------
  const settings = (): Settings => {
    try {
      return { ...DEFAULTS, ...(JSON.parse(ctx.getKV('codex.settings') ?? '{}') as Partial<Settings>) };
    } catch {
      return DEFAULTS;
    }
  };
  const saveSettings = (s: Partial<Settings>) => ctx.setKV('codex.settings', JSON.stringify({ ...settings(), ...s }));
  const getAwait = (): Await => {
    try {
      return JSON.parse(ctx.getKV('codex.await') ?? 'null') as Await;
    } catch {
      return null;
    }
  };
  const setAwait = (a: Await) => ctx.setKV('codex.await', JSON.stringify(a));

  type ModelInfo = { slug: string; efforts: string[]; def?: string };
  function models(): ModelInfo[] {
    try {
      const d = JSON.parse(fs.readFileSync(MODELS_CACHE, 'utf8')) as { models?: unknown[] } | unknown[];
      const list = (Array.isArray(d) ? d : (d.models ?? [])) as Record<string, any>[];
      return list
        .filter((m) => (m.visibility ?? 'list') === 'list')
        .map((m) => ({
          slug: String(m.slug ?? m.id),
          efforts: (m.supported_reasoning_levels ?? []).map((x: { effort: string }) => x.effort),
          def: m.default_reasoning_level,
        }));
    } catch {
      return [{ slug: DEFAULTS.model, efforts: ['low', 'medium', 'high', 'xhigh'] }];
    }
  }
  const findModel = (q: string) => {
    const ms = models();
    return ms.find((m) => m.slug === q) ?? ms.find((m) => m.slug.includes(q));
  };

  // ---------------- Jobs auf der Platte ----------------
  const jobDir = (id: string) => path.join(ROOT, id);
  const readMeta = (id: string): Meta | null => {
    try {
      return JSON.parse(fs.readFileSync(path.join(jobDir(id), 'meta.json'), 'utf8')) as Meta;
    } catch {
      return null;
    }
  };
  const writeMeta = (m: Meta) => fs.writeFileSync(path.join(jobDir(m.id), 'meta.json'), JSON.stringify(m));
  const allJobs = (): Meta[] => {
    try {
      return fs
        .readdirSync(ROOT)
        .map(readMeta)
        .filter((m): m is Meta => !!m)
        .sort((a, b) => b.started - a.started);
    } catch {
      return [];
    }
  };
  const exitOf = (id: string): string | null => {
    try {
      return fs.readFileSync(path.join(jobDir(id), 'exit'), 'utf8').trim();
    } catch {
      return null;
    }
  };
  function isRunning(m: Meta): boolean {
    if (exitOf(m.id) !== null) return false;
    if (m.runner === 'systemd' && m.unit) {
      try {
        const st = execFileSync('systemctl', ['--user', 'is-active', m.unit], { env: JOB_ENV, encoding: 'utf8' }).trim();
        return st === 'active' || st === 'activating';
      } catch (e) {
        const out = String((e as { stdout?: string }).stdout ?? '').trim();
        return out === 'activating';
      }
    }
    try {
      if (m.pid) process.kill(m.pid, 0);
      return !!m.pid;
    } catch {
      return false;
    }
  }

  const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  function startJob(o: { prompt: string; s: Settings; resumeOf?: Meta; lehrer?: boolean; engine?: 'codex' | 'claude'; video?: Meta['video'] }): Meta {
    fs.mkdirSync(ROOT, { recursive: true });
    const id = Date.now().toString(36);
    const dir = jobDir(id);
    fs.mkdirSync(dir);
    const cwd = o.resumeOf?.cwd ?? o.s.cwd;
    const engine = o.engine ?? o.resumeOf?.engine ?? 'codex';
    const fullPrompt = o.lehrer && !o.resumeOf ? LEHRER_PREFIX + o.prompt : o.prompt;
    fs.writeFileSync(path.join(dir, 'prompt.txt'), fullPrompt);
    let bin: string;
    let args: string[];
    if (engine === 'claude') {
      // Claude Code headless; Rechte kommen aus <cwd>/.claude/settings.json (Freigabeliste), alles andere wird abgelehnt
      bin = CLAUDE;
      args = ['-p', '--output-format', 'stream-json', '--verbose', '--model', o.s.model, '--permission-mode', 'acceptEdits', ...(o.resumeOf?.threadId ? ['--resume', o.resumeOf.threadId] : [])];
    } else {
      bin = CODEX;
      const common = ['--json', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '-m', o.s.model, '-c', `model_reasoning_effort="${o.s.effort}"`, '-o', path.join(dir, 'last.txt')];
      args = o.resumeOf?.threadId ? ['exec', 'resume', ...common, o.resumeOf.threadId, '-'] : ['exec', ...common, '-C', cwd, '-'];
    }
    const pathEnv = engine === 'claude' ? `${VIDEO_DIR}/bin:${PATH_ENV}` : PATH_ENV;
    const script = [
      '#!/bin/bash',
      `export PATH=${sq(pathEnv)}`,
      `cd ${sq(cwd)} || { echo 1 > ${sq(path.join(dir, 'exit'))}; exit 1; }`,
      `${sq(bin)} ${args.map(sq).join(' ')} < ${sq(path.join(dir, 'prompt.txt'))} > ${sq(path.join(dir, 'events.jsonl'))} 2> ${sq(path.join(dir, 'stderr.log'))}`,
      `echo $? > ${sq(path.join(dir, 'exit'))}`,
    ].join('\n');
    const runSh = path.join(dir, 'run.sh');
    fs.writeFileSync(runSh, script, { mode: 0o755 });
    const meta: Meta = {
      ...o.s,
      cwd,
      id,
      prompt: o.prompt,
      started: Date.now(),
      parent: o.resumeOf?.id,
      threadId: o.resumeOf?.threadId,
      lehrer: o.lehrer || o.resumeOf?.lehrer,
      engine,
      video: o.video ?? o.resumeOf?.video,
      runner: 'systemd',
    };
    const unit = `codex-tg-${id}`;
    try {
      execFileSync('systemd-run', ['--user', '--collect', '--quiet', `--unit=${unit}`, '-p', `MemoryMax=${meta.video ? '9G' : '6G'}`, '-p', `WorkingDirectory=${cwd}`, '/bin/bash', runSh], { env: JOB_ENV, stdio: 'pipe' });
      meta.unit = unit;
    } catch (e) {
      log('systemd-run nicht möglich, Fallback spawn:', (e as Error).message.split('\n')[0]);
      const child = spawn('/bin/bash', [runSh], { detached: true, stdio: 'ignore', cwd });
      child.unref();
      meta.runner = 'spawn';
      meta.pid = child.pid;
    }
    writeMeta(meta);
    return meta;
  }

  function stopJob(m: Meta) {
    if (m.runner === 'systemd' && m.unit) {
      try {
        execFileSync('systemctl', ['--user', 'stop', m.unit], { env: JOB_ENV, stdio: 'pipe' });
      } catch {
        /* schon weg */
      }
    } else if (m.pid) {
      try {
        process.kill(-m.pid, 'SIGTERM');
      } catch {
        /* schon weg */
      }
    }
    if (exitOf(m.id) === null) fs.writeFileSync(path.join(jobDir(m.id), 'exit'), 'stopped');
  }

  // ---------------- Events lesen ----------------
  type Parsed = { threadId?: string; acts: string[]; lastMsg?: string; error?: string; tokens?: number; todo?: string };
  function parse(m: Meta): Parsed {
    const out: Parsed = { acts: [] };
    let raw = '';
    try {
      raw = fs.readFileSync(path.join(jobDir(m.id), 'events.jsonl'), 'utf8');
    } catch {
      return out;
    }
    const items = new Map<string, string>();
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let ev: Record<string, any>;
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      // ---- Claude Code (stream-json) ----
      if (ev.type === 'system' && ev.subtype === 'init') {
        out.threadId = ev.session_id;
        continue;
      }
      if (ev.type === 'assistant' && ev.message?.content) {
        for (const c of ev.message.content as Record<string, any>[]) {
          if (c.type === 'text' && String(c.text).trim()) {
            out.lastMsg = c.text;
            items.set(`t${items.size}`, `💬 ${String(c.text).split('\n')[0]!.slice(0, 140)}`);
          } else if (c.type === 'tool_use') {
            const inp = (c.input ?? {}) as Record<string, any>;
            const what = inp.command ?? inp.file_path ?? inp.pattern ?? inp.query ?? inp.description ?? inp.prompt ?? '';
            const name = String(c.name).replace(/^mcp__claude_ai_ElevenLabs__/, '🎙 ').replace(/^mcp__/, '🔧 ');
            items.set(c.id ?? `u${items.size}`, `${c.name === 'Bash' ? '$' : name} ${String(what).replace(/\s+/g, ' ').slice(0, 140)}`);
            if (c.name === 'TodoWrite' && Array.isArray(inp.todos)) {
              out.todo = (inp.todos as { content: string; status: string }[]).map((t) => `${t.status === 'completed' ? '☑' : t.status === 'in_progress' ? '▶' : '☐'} ${t.content}`).join('\n');
            }
          }
        }
        continue;
      }
      if (ev.type === 'result') {
        if (ev.result) out.lastMsg = ev.result;
        if (ev.is_error) out.error = String(ev.result || ev.subtype || 'Fehler');
        const u = ev.usage ?? {};
        out.tokens = (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
        if (ev.session_id) out.threadId = ev.session_id;
        continue;
      }
      // ---- Codex (exec --json) ----
      if (ev.type === 'thread.started') out.threadId = ev.thread_id;
      else if (ev.type === 'turn.completed') out.tokens = (out.tokens ?? 0) + (ev.usage?.input_tokens ?? 0) + (ev.usage?.output_tokens ?? 0);
      else if (ev.type === 'turn.failed') out.error = ev.error?.message ?? 'Turn fehlgeschlagen';
      else if (ev.type === 'error') out.error = ev.message ?? 'Fehler';
      else if (ev.item) {
        const it = ev.item as Record<string, any>;
        const done = ev.type === 'item.completed';
        let s = '';
        switch (it.type) {
          case 'command_execution': {
            const cmd = String(it.command ?? it.cmd ?? '').replace(/^\/bin\/(ba)?sh -lc /, '').slice(0, 140);
            const code = it.exit_code ?? it.exitCode;
            s = `${done ? (code === 0 || code === undefined ? '✓' : `✗${code}`) : '…'} $ ${cmd}`;
            break;
          }
          case 'agent_message':
            out.lastMsg = it.text;
            s = `💬 ${String(it.text ?? '').split('\n')[0]!.slice(0, 140)}`;
            break;
          case 'reasoning':
            s = `💭 ${String(it.text ?? '').replace(/\*\*/g, '').split('\n')[0]!.slice(0, 140)}`;
            break;
          case 'file_change':
            s = `✏️ ${(it.changes ?? []).map((c: { path: string; kind?: string }) => tilde(c.path)).join(', ').slice(0, 160)}`;
            break;
          case 'web_search':
            s = `🔎 ${String(it.query ?? '').slice(0, 140)}`;
            break;
          case 'mcp_tool_call':
            s = `🔧 ${it.server ?? ''}.${it.tool ?? ''}`;
            break;
          case 'todo_list': {
            const list = (it.items ?? []) as { text: string; completed: boolean }[];
            out.todo = list.map((t) => `${t.completed ? '☑' : '☐'} ${t.text}`).join('\n');
            continue;
          }
          case 'error':
            s = `⚠️ ${it.message ?? ''}`;
            break;
          default:
            continue;
        }
        items.delete(it.id);
        items.set(it.id ?? String(items.size), s);
      }
    }
    out.acts = [...items.values()];
    return out;
  }

  // ---------------- Anzeigen ----------------
  function card(m: Meta): { text: string; kb: Keyboard; running: boolean; state: string } {
    const running = isRunning(m);
    const p = parse(m);
    if (p.threadId && p.threadId !== m.threadId) writeMeta({ ...m, threadId: p.threadId });
    const ex = exitOf(m.id);
    const state = running ? 'running' : ex === '0' ? 'done' : ex === 'stopped' ? 'stopped' : ex === null ? 'lost' : 'failed';
    const head = { running: '⏳ läuft', done: '✅ fertig', stopped: '⏹ gestoppt', lost: '⚠️ abgebrochen', failed: '❌ Fehler' }[state];
    let elapsed = Date.now() - m.started;
    try {
      if (!running) elapsed = fs.statSync(path.join(jobDir(m.id), ex !== null ? 'exit' : 'events.jsonl')).mtimeMs - m.started;
    } catch {
      /* egal */
    }
    const lines = [
      `<b>${head} · ${m.video ? (m.video === 'idea' ? '🎬 Video-Idee' : '🎬 Video') : m.lehrer ? '📚 Lehrer' : '🧠 Codex'}</b> · ${fmtDur(elapsed)}${p.tokens ? ` · ${Math.round(p.tokens / 1000)}k Tokens` : ''}`,
      `<code>${esc(m.model)}</code> · ${esc(m.effort)} · ${esc(tilde(m.cwd))}${m.parent ? ' · ↪️ Fortsetzung' : ''} · #${m.id}`,
      `<i>${esc(m.prompt.slice(0, 220))}${m.prompt.length > 220 ? ' …' : ''}</i>`,
    ];
    if (p.todo) lines.push('', esc(p.todo.slice(0, 900)));
    const acts = p.acts.slice(running ? -10 : -5);
    if (acts.length) lines.push('', `<pre>${esc(acts.join('\n').slice(-1800))}</pre>`);
    if (p.error) lines.push('', `⚠️ ${esc(p.error.slice(0, 500))}`);
    if (state === 'failed' || state === 'lost') {
      try {
        const err = fs.readFileSync(path.join(jobDir(m.id), 'stderr.log'), 'utf8').trim().split('\n').slice(-6).join('\n');
        if (err) lines.push(`<pre>${esc(err.slice(-800))}</pre>`);
      } catch {
        /* egal */
      }
    }
    const kb: Keyboard = running
      ? [[btn('⏹ Stop', `stop:${m.id}`), btn('🔁 Aktualisieren', `open:${m.id}`)]]
      : m.video
        ? videoKb(m)
        : [
          [btn('↪️ Weiterschreiben', `cont:${m.id}`), btn('🔁 Nochmal', `again:${m.id}`)],
          [btn('📜 Antwort erneut', `ans:${m.id}`), btn('🧠 Codex', 'home')],
        ];
    return { text: lines.join('\n'), kb, running, state };
  }

  /** Markdown von Codex → Telegram-HTML (Codeblöcke, Inline-Code, fett, Überschriften). */
  function mdToHtml(md: string): string {
    const parts = md.split(/```[^\n]*\n?/);
    return parts
      .map((p, i) =>
        i % 2
          ? `<pre>${esc(p.replace(/\n$/, ''))}</pre>`
          : esc(p)
              .replace(/`([^`\n]+)`/g, '<code>$1</code>')
              .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
              .replace(/^#{1,6} (.+)$/gm, '<b>$1</b>')
              .replace(/\[([^\]\n]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>'),
      )
      .join('');
  }
  function chunks(text: string, size = 3500): string[] {
    const out: string[] = [];
    let rest = text;
    while (rest.length > size) {
      let cut = rest.lastIndexOf('\n', size);
      if (cut < size / 2) cut = size;
      let piece = rest.slice(0, cut);
      // Codeblock nicht offen lassen
      if ((piece.match(/```/g) ?? []).length % 2) {
        piece += '\n```';
        rest = '```\n' + rest.slice(cut);
      } else rest = rest.slice(cut);
      out.push(piece);
    }
    if (rest.trim()) out.push(rest);
    return out;
  }

  async function sendAnswer(m: Meta) {
    let answer = '';
    try {
      answer = fs.readFileSync(path.join(jobDir(m.id), 'last.txt'), 'utf8').trim();
    } catch {
      answer = parse(m).lastMsg ?? '';
    }
    if (!answer) answer = '(keine Antwort)';
    const parts = chunks(answer);
    const kb: Keyboard = m.video ? videoKb(m) : [[btn('↪️ Weiterschreiben', `cont:${m.id}`), btn('🧠 Codex', 'home')]];
    for (let i = 0; i < parts.length; i++) {
      const last = i === parts.length - 1;
      const body = { chat_id: ctx.chat, disable_web_page_preview: true, ...(last ? { reply_markup: { inline_keyboard: kb } } : {}) };
      const icon = m.video ? '🎬' : m.lehrer ? '📚' : '🧠';
      const hint = m.video && last ? '\n\n<i>Antworte einfach mit Text (Änderung, Feedback, eigene Idee) oder nimm einen Button.</i>' : '';
      const header = i === 0 ? `${icon} <b>#${m.id}</b>${parts.length > 1 ? ` (1/${parts.length})` : ''}\n\n` : '';
      const html = header + mdToHtml(parts[i]!) + hint;
      let sent: { message_id: number };
      try {
        sent = await ctx.tg<{ message_id: number }>('sendMessage', { ...body, text: html, parse_mode: 'HTML' });
      } catch {
        sent = await ctx.tg<{ message_id: number }>('sendMessage', { ...body, text: parts[i]!.slice(0, 4000) });
      }
      ctx.setKV(`codex.msg.${sent.message_id}`, m.id);
    }
    if (answer.length > 12_000) {
      const fd = new FormData();
      fd.set('chat_id', ctx.chat);
      fd.set('document', new Blob([answer], { type: 'text/markdown' }), `codex-${m.id}.md`);
      await ctx.tg('sendDocument', fd).catch(() => {});
    }
    if (m.lehrer) ctx.setKV('codex.lehrer', JSON.stringify({ id: m.id, at: Date.now() }));
    setAwait({ kind: 'continue', id: m.id });
  }

  // ---------------- Beobachten ----------------
  const watchList = (): string[] => {
    try {
      return JSON.parse(ctx.getKV('codex.watch') ?? '[]') as string[];
    } catch {
      return [];
    }
  };
  const setWatch = (ids: string[]) => ctx.setKV('codex.watch', JSON.stringify(ids));

  async function showJob(m: Meta, editId?: number, note = '') {
    const c = card(m);
    const msg = (await ctx.show(`${note ? `${note}\n\n` : ''}${c.text}`, c.kb, editId)) as { message_id?: number } | undefined;
    const mid = msg?.message_id ?? editId;
    if (mid) {
      writeMeta({ ...(readMeta(m.id) ?? m), messageId: mid });
      ctx.setKV(`codex.msg.${mid}`, m.id);
    }
    if (c.running && !watchList().includes(m.id)) setWatch([...watchList(), m.id]);
  }

  /** alle 10 s: laufende Jobs im Chat aktualisieren, fertige Antworten schicken */
  async function tick() {
    for (const id of watchList()) {
      const m = readMeta(id);
      if (!m) {
        setWatch(watchList().filter((x) => x !== id));
        continue;
      }
      const c = card(m);
      if (m.messageId) {
        await ctx
          .tg('editMessageText', { chat_id: ctx.chat, message_id: m.messageId, text: c.text.slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: { inline_keyboard: c.kb } })
          .catch(() => {});
      }
      if (!c.running) {
        setWatch(watchList().filter((x) => x !== id));
        if (c.state === 'done' || c.state === 'failed') await sendAnswer(m).catch((e) => log('Antwort', e));
      }
    }
  }

  // ---------------- Bildschirme ----------------
  function home(editId?: number, note = '') {
    const s = settings();
    setAwait({ kind: 'prompt' });
    const running = allJobs().filter(isRunning).length;
    return ctx.show(
      [
        note,
        '<b>🧠 Codex</b>',
        `Modell: <code>${esc(s.model)}</code>`,
        `Reasoning: <b>${esc(s.effort)}</b>`,
        `Ordner: <code>${esc(tilde(s.cwd))}</code>`,
        running ? `\n⏳ ${running} Job(s) laufen gerade.` : '',
        '',
        '✍️ <b>Schick mir jetzt die Aufgabe</b> als Nachricht.',
        'Schnell: <code>/codex m=luna r=xhigh d=lernquest Aufgabe…</code>',
      ]
        .filter((l, i) => l || i > 0)
        .join('\n')
        .trim(),
      [
        [btn('🤖 Modell', 'models'), btn('🧠 Reasoning', 'efforts')],
        [btn('📁 Ordner', 'dirs'), btn('📋 Jobs', 'jobs')],
        [{ text: '⬅️ Menü', callback_data: 'menu' }],
      ],
      editId,
    );
  }

  function modelsScreen(editId?: number) {
    const cur = settings().model;
    const ms = models();
    return ctx.show('<b>🤖 Modell wählen</b>', [...ms.map((m) => [btn(`${m.slug === cur ? '✅ ' : ''}${m.slug}`, `model:${m.slug}`)]), [btn('⬅️ Zurück', 'home')]], editId);
  }
  function effortsScreen(editId?: number) {
    const s = settings();
    const efforts = findModel(s.model)?.efforts ?? ['low', 'medium', 'high', 'xhigh'];
    const rows: Keyboard = [];
    for (let i = 0; i < efforts.length; i += 3) rows.push(efforts.slice(i, i + 3).map((e) => btn(`${e === s.effort ? '✅ ' : ''}${e}`, `eff:${e}`)));
    return ctx.show(`<b>🧠 Reasoning für ${esc(s.model)}</b>`, [...rows, [btn('⬅️ Zurück', 'home')]], editId);
  }
  function dirsScreen(editId?: number) {
    const cur = settings().cwd;
    const recent = (JSON.parse(ctx.getKV('codex.recentDirs') ?? '[]') as string[]).filter((d) => !DIR_PRESETS.some(([, p]) => p === d));
    const all: [string, string][] = [...DIR_PRESETS, ...recent.map((d): [string, string] => [`📂 ${tilde(d)}`, d])];
    ctx.setKV('codex.dirChoices', JSON.stringify(all.map(([, p]) => p)));
    return ctx.show(
      `<b>📁 Arbeitsordner</b>\nAktuell: <code>${esc(tilde(cur))}</code>`,
      [...all.map(([label, p], i) => [btn(`${p === cur ? '✅ ' : ''}${label}`, `dir:${i}`)]), [btn('✏️ Pfad eingeben', 'dirask'), btn('⬅️ Zurück', 'home')]],
      editId,
    );
  }
  function setDir(p: string): string | null {
    const abs = untilde(p.trim());
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return `Ordner <code>${esc(abs)}</code> gibt es nicht.`;
    saveSettings({ cwd: abs });
    const recent = [abs, ...(JSON.parse(ctx.getKV('codex.recentDirs') ?? '[]') as string[]).filter((d) => d !== abs)].slice(0, 5);
    ctx.setKV('codex.recentDirs', JSON.stringify(recent));
    return null;
  }

  function jobsScreen(editId?: number) {
    const jobs = allJobs().slice(0, 12);
    if (!jobs.length) return ctx.show('📋 Noch keine Jobs.', [[btn('⬅️ Zurück', 'home')]], editId);
    const icon = (m: Meta) => (isRunning(m) ? '⏳' : ({ '0': '✅', stopped: '⏹' } as Record<string, string>)[exitOf(m.id) ?? ''] ?? '❌');
    return ctx.show(
      '<b>📋 Jobs</b> – tippe einen an:',
      [...jobs.map((m) => [btn(`${icon(m)} ${m.lehrer ? '📚' : ''}#${m.id} ${m.prompt}`.slice(0, 58), `open:${m.id}`)]), [btn('⬅️ Zurück', 'home')]],
      editId,
    );
  }

  function artemisScreen(editId?: number, refresh = false) {
    return new Promise<unknown>((resolve) => {
      execFile('python3', [ARTEMIS, 'status', ...(refresh ? ['--refresh'] : [])], { timeout: 60_000, env: { ...process.env, PATH: PATH_ENV } }, (err, stdout, stderr) => {
        const out = (stdout || stderr || (err ? err.message : '')).trim();
        resolve(
          ctx.show(
            `<b>📅 Artemis</b>\n<pre>${esc(out.slice(0, 3700))}</pre>`,
            [[btn('📄 Alles als .md', 'amd'), btn('🔁 Neu laden', 'artemis:r')], [btn('📚 Lehrer: Plan', 'lplan'), { text: '⬅️ Menü', callback_data: 'menu' }]],
            editId,
          ),
        );
      });
    });
  }

  /** Kompletter Artemis-Stand als .md: Überblick, Abgaben, Testergebnisse, Aufgabenstellungen (artemis export) */
  async function artemisExport(editId?: number) {
    await ctx.show('⏳ Hole alles aus Artemis (Abgaben, Tests, Aufgabenstellungen) … ca. 15 s', [], editId);
    const out = path.join(os.tmpdir(), `artemis-${Date.now()}.md`);
    const r = await new Promise<{ err: Error | null; stderr: string }>((resolve) =>
      execFile('python3', [ARTEMIS, 'export', '--out', out], { timeout: 180_000, env: { ...process.env, PATH: PATH_ENV } }, (err, _o, stderr) => resolve({ err, stderr })),
    );
    if (r.err || !fs.existsSync(out)) {
      return ctx.show(`⚠️ Export fehlgeschlagen:\n<pre>${esc((r.stderr || r.err?.message || '').slice(-1500))}</pre>`, [[btn('📅 Artemis', 'artemis'), { text: '⬅️ Menü', callback_data: 'menu' }]]);
    }
    const md = fs.readFileSync(out, 'utf8');
    fs.unlinkSync(out);
    const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
    const fd = new FormData();
    fd.set('chat_id', ctx.chat);
    fd.set('caption', `📄 Artemis-Stand komplett (ERA + EIP) · ${md.split('\n').length} Zeilen\nÜberblick, alle Abgaben, Testergebnisse und Aufgabenstellungen.`);
    fd.set('document', new Blob([md], { type: 'text/markdown' }), `artemis_${day}.md`);
    fd.set('reply_markup', JSON.stringify({ inline_keyboard: [[btn('📅 Artemis', 'artemis'), { text: '⬅️ Menü', callback_data: 'menu' }]] }));
    await ctx.tg('sendDocument', fd, 60_000);
  }

  // ---------------- Starten ----------------
  /** Fortsetzung/Wiederholung: gleiches Modell, Reasoning und Ordner wie der ursprüngliche Job */
  const sameAs = (m: Meta): Settings => ({ model: m.model, effort: m.effort, cwd: m.cwd });

  async function run(prompt: string, s: Settings, opts: { resumeOf?: Meta; lehrer?: boolean } = {}) {
    if (opts.resumeOf && allJobs().some((j) => j.threadId === opts.resumeOf!.threadId && isRunning(j))) {
      return ctx.show('⏳ Dieser Thread arbeitet noch – warte auf die Antwort oder stoppe ihn unter 📋 Jobs.', [[btn('📋 Jobs', 'jobs')]]);
    }
    if (opts.resumeOf && !opts.resumeOf.threadId) {
      // threadId steht evtl. erst in den Events (Codex: thread.started, Claude: system/init)
      const p = parse(opts.resumeOf);
      if (!p.threadId) return ctx.show('Zu diesem Job gibt es keine Sitzung zum Fortsetzen.', [[btn('🧠 Codex', 'home')]]);
      opts.resumeOf = { ...opts.resumeOf, threadId: p.threadId };
    }
    setAwait(null);
    const m = startJob({ prompt, s, ...opts });
    return showJob(m);
  }

  // ---------------- Video-Studio ----------------
  const videoSettings = (): Settings => ({ model: VIDEO_MODEL, effort: 'claude', cwd: VIDEO_DIR });
  function videoKb(m: Meta): Keyboard {
    return m.video === 'idea'
      ? [
          [btn('🎬 Los, produzieren', `vgo:${m.id}`), btn('💡 Andere Idee', 'vnew')],
          [btn('✏️ Eigene Idee', 'vown'), btn('📋 Jobs', 'jobs')],
        ]
      : [
          [btn('🔁 Revision', `vrev:${m.id}`), btn('✅ Fertig', `vdone:${m.id}`)],
          [btn('💡 Neue Idee', 'vnew'), btn('📜 Verlauf', `open:${m.id}`)],
        ];
  }
  function videoScreen(editId?: number) {
    const running = allJobs().filter((j) => j.video && isRunning(j));
    return ctx.show(
      [
        '<b>🎬 Video-Studio</b>',
        'Claude produziert auf dem VPS mit dem Skill viral-remotion-director: Idee → Skript → Stimmen (ElevenLabs) → Remotion-Render → Video hier im Chat.',
        'Jeden Tag um 10:00 kommt automatisch ein Vorschlag.',
        running.length ? `\n⏳ Läuft gerade: ${running.map((j) => `#${j.id}`).join(', ')}` : '',
        '',
        'Schnell: <code>/video Döner-Preise in Berlin als Doku</code>',
      ]
        .filter(Boolean)
        .join('\n'),
      [[btn('💡 Idee vorschlagen', 'vnew'), btn('✏️ Eigene Idee', 'vown')], [btn('📋 Jobs', 'jobs'), { text: '⬅️ Menü', callback_data: 'menu' }]],
      editId,
    );
  }
  /** neue Claude-Sitzung, die eine Idee vorschlägt (Button, /video idee, n8n um 10:00) */
  function videoIdea(note = '') {
    const m = startJob({ prompt: VIDEO_IDEA_PROMPT, s: videoSettings(), engine: 'claude', video: 'idea' });
    return showJob(m, undefined, note);
  }
  function videoOwn(text: string) {
    const prompt = `${VIDEO_RULES}\n\nIch will dieses Video:\n${text}\n\nSchick mir zuerst per \`tg msg\` dein Konzept in Kurzform (Titel, Hook, Ablauf) und produziere es dann direkt komplett – nicht auf eine Antwort warten, außer etwas Wichtiges ist wirklich unklar.`;
    return showJob(startJob({ prompt, s: videoSettings(), engine: 'claude', video: 'produce' }));
  }
  /** Antwort auf einen Video-Job → gleiche Claude-Sitzung, ab jetzt Produktionsphase */
  function videoContinue(prev: Meta, text: string) {
    const extra =
      prev.video === 'idea'
        ? '\n\n(Ist das eine Freigabe oder Änderung der Idee: produziere das Video jetzt komplett nach den Regeln, mit tg-Updates und am Ende dem fertigen Video. Will ich eine andere Idee: schlag eine neue vor und warte.)'
        : '\n\n(Setz das um. Bei Änderungen am Video: neu rendern als nächste Version und per tg video schicken.)';
    return run(`Meine Antwort (Telegram): ${text}${extra}`, sameAs(prev), { resumeOf: { ...prev, video: 'produce' } });
  }

  /** "/codex m=luna r=high d=lernquest Aufgabe" → einmalige Einstellungen + Aufgabe */
  function parseInline(text: string): { s: Settings; prompt: string; error?: string } {
    const s = settings();
    const words = text.trim().split(/\s+/);
    while (words.length && /^(m|r|d)=/.test(words[0]!)) {
      const [k, v = ''] = words.shift()!.split(/=(.*)/s) as [string, string];
      if (k === 'm') {
        const m = findModel(v);
        if (!m) return { s, prompt: '', error: `Modell „${esc(v)}“ kenne ich nicht.` };
        s.model = m.slug;
        if (!m.efforts.includes(s.effort)) s.effort = m.def ?? m.efforts[0] ?? s.effort;
      } else if (k === 'r') s.effort = v;
      else if (k === 'd') {
        const preset = DIR_PRESETS.find(([l]) => l.toLowerCase().includes(v.toLowerCase()));
        const abs = preset ? preset[1] : untilde(v);
        if (!fs.existsSync(abs)) return { s, prompt: '', error: `Ordner <code>${esc(abs)}</code> gibt es nicht.` };
        s.cwd = abs;
      }
    }
    return { s, prompt: words.join(' ') };
  }

  function lehrer(text: string) {
    const t = text.trim();
    if (/^neu\b/i.test(t)) {
      ctx.setKV('codex.lehrer', '');
      const rest = t.replace(/^neu\b\s*/i, '');
      if (!rest) {
        setAwait({ kind: 'lehrer' });
        return ctx.show('📚 Neues Lehrer-Gespräch. Was willst du lernen?', [[btn('📅 Was ist fällig?', 'lplan')]]);
      }
      return run(rest, { ...settings(), cwd: STUDIUM }, { lehrer: true });
    }
    if (!t) {
      setAwait({ kind: 'lehrer' });
      return ctx.show(
        '<b>📚 Lehrer</b>\nFrag einfach: „erklär mir Calling Convention“, „frag mich DS VO5 ab“, „hilf mir bei der ERA-Hausaufgabe“ …\n\nDas Gespräch läuft weiter, bis du <code>/lehrer neu</code> schreibst.',
        [[btn('📅 Was ist fällig?', 'lplan'), btn('🆕 Neues Gespräch', 'lnew')], [{ text: '⬅️ Menü', callback_data: 'menu' }]],
      );
    }
    let last: { id: string; at: number } | null = null;
    try {
      last = JSON.parse(ctx.getKV('codex.lehrer') || 'null');
    } catch {
      /* neu */
    }
    const prev = last && Date.now() - last.at < 12 * 3600_000 ? readMeta(last.id) : null;
    return prev ? run(t, sameAs(prev), { resumeOf: prev, lehrer: true }) : run(t, { ...settings(), cwd: STUDIUM }, { lehrer: true });
  }

  // ---------------- Öffentliche Schnittstelle ----------------
  async function onButton(data: string, editId: number) {
    const [action = '', ...restParts] = data.split(':');
    const arg = restParts.join(':');
    switch (action) {
      case 'home':
        return home(editId);
      case 'models':
        return modelsScreen(editId);
      case 'model': {
        const m = findModel(arg);
        if (m) saveSettings({ model: m.slug, ...(m.efforts.includes(settings().effort) ? {} : { effort: m.def ?? m.efforts[0] }) });
        return home(editId, `✅ Modell: ${esc(arg)}`);
      }
      case 'efforts':
        return effortsScreen(editId);
      case 'eff':
        saveSettings({ effort: arg });
        return home(editId, `✅ Reasoning: ${esc(arg)}`);
      case 'dirs':
        return dirsScreen(editId);
      case 'dir': {
        const choices = JSON.parse(ctx.getKV('codex.dirChoices') ?? '[]') as string[];
        const err = choices[Number(arg)] ? setDir(choices[Number(arg)]!) : 'Unbekannt.';
        return home(editId, err ?? '✅ Ordner gesetzt.');
      }
      case 'dirask':
        setAwait({ kind: 'cwd' });
        return ctx.show('📁 Schick mir den Pfad (z. B. <code>~/apps/kassenbuch</code>).', [[btn('Abbrechen', 'home')]], editId);
      case 'jobs':
        return jobsScreen(editId);
      case 'open': {
        const m = readMeta(arg);
        return m ? showJob(m, editId) : jobsScreen(editId);
      }
      case 'stop': {
        const m = readMeta(arg);
        if (m) stopJob(m);
        return m ? showJob(m, editId) : jobsScreen(editId);
      }
      case 'cont': {
        const m = readMeta(arg);
        if (!m) return home(editId);
        setAwait({ kind: 'continue', id: m.id });
        return ctx.show(`↪️ Was soll #${m.id} als Nächstes tun? Schick es als Nachricht.`, [[btn('Abbrechen', 'home')]]);
      }
      case 'again': {
        const m = readMeta(arg);
        return m ? run(m.prompt, sameAs(m), { lehrer: m.lehrer }) : home(editId);
      }
      case 'ans': {
        const m = readMeta(arg);
        return m ? sendAnswer(m) : home(editId);
      }
      case 'lehrer':
        return lehrer('');
      case 'lnew':
        return lehrer('neu');
      case 'lplan':
        return lehrer('Was ist in ERA und EIP fällig, wie ist mein Stand, und was sollte ich heute lernen? Kurzer Plan.');
      case 'artemis':
        return artemisScreen(editId, arg === 'r');
      case 'amd':
        return artemisExport(editId);
      case 'video':
        return videoScreen(editId);
      case 'vnew':
        return videoIdea();
      case 'vown':
        setAwait({ kind: 'video' });
        return ctx.show('✏️ Beschreib dein Video (Thema, Gag, Ort, Figuren – so grob oder genau wie du willst).', [[btn('Abbrechen', 'video')]]);
      case 'vgo': {
        const m = readMeta(arg);
        return m ? videoContinue(m, 'Go, passt so – produzieren!') : videoScreen(editId);
      }
      case 'vrev': {
        const m = readMeta(arg);
        if (!m) return videoScreen(editId);
        setAwait({ kind: 'continue', id: m.id });
        return ctx.show(`🔁 Was soll an #${m.id} anders werden? Schick es als Nachricht.`, [[btn('Abbrechen', 'video')]]);
      }
      case 'vdone': {
        const m = readMeta(arg);
        return m
          ? run('Fertig, passt so. Trag die Learnings aus diesem Video in learnings.md ein (was gut lief, was ich geändert haben wollte), räum temporäre Dateien auf und bestätige kurz.', sameAs(m), { resumeOf: m })
          : videoScreen(editId);
      }
    }
    return home(editId);
  }

  /** Slash-Befehle; true = erledigt */
  async function onCommand(text: string): Promise<boolean> {
    const m = /^\/(codex|cx|c|lehrer|l|jobs|artemis|md|export|video|v)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text.trim());
    if (!m) return false;
    const cmd = m[1]!.toLowerCase();
    const rest = (m[2] ?? '').trim();
    if (cmd === 'video' || cmd === 'v') {
      if (!rest) await videoScreen();
      else if (/^(idee|idea|vorschlag)$/i.test(rest)) await videoIdea();
      else await videoOwn(rest);
    } else if (cmd === 'jobs') await jobsScreen();
    else if (cmd === 'artemis') await artemisScreen();
    else if (cmd === 'md' || cmd === 'export') await artemisExport();
    else if (cmd === 'lehrer' || cmd === 'l') await lehrer(rest);
    else if (!rest) await home();
    else {
      const p = parseInline(rest);
      if (p.error) await ctx.show(`⚠️ ${p.error}`);
      else if (!p.prompt) {
        saveSettings(p.s);
        await home(undefined, '✅ Einstellungen übernommen.');
      } else await run(p.prompt, p.s);
    }
    return true;
  }

  /** Freier Text / Antwort auf eine Bot-Nachricht; true = erledigt */
  async function onText(text: string, replyToId?: number): Promise<boolean> {
    if (replyToId) {
      const id = ctx.getKV(`codex.msg.${replyToId}`);
      const prev = id ? readMeta(id) : null;
      if (prev) {
        if (prev.video) await videoContinue(prev, text);
        else await run(text, sameAs(prev), { resumeOf: prev });
        return true;
      }
      return false;
    }
    const a = getAwait();
    if (!a) return false;
    if (a.kind === 'cwd') {
      const err = setDir(text);
      if (err) await ctx.show(err, [[btn('⬅️ Zurück', 'dirs')]]);
      else await home(undefined, '✅ Ordner gesetzt.');
      return true;
    }
    if (a.kind === 'lehrer') {
      await lehrer(text);
      return true;
    }
    if (a.kind === 'prompt') {
      await run(text, settings());
      return true;
    }
    if (a.kind === 'video') {
      await videoOwn(text);
      return true;
    }
    if (a.kind === 'continue') {
      const prev = readMeta(a.id);
      if (!prev) return false;
      if (prev.video) await videoContinue(prev, text);
      else await run(text, sameAs(prev), { resumeOf: prev });
      return true;
    }
    return false;
  }

  return {
    onButton,
    onCommand,
    onText,
    videoIdea,
    tick,
    clearAwait: () => setAwait(null),
  };
}
