import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const now = sql`(cast(unixepoch('subsec') * 1000 as integer))`;
const ts = (name: string) => integer(name).notNull().default(now);

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['user', 'admin'] }).notNull().default('user'),
  disabled: integer('disabled', { mode: 'boolean' }).notNull().default(false),
  mustChangePassword: integer('must_change_password', { mode: 'boolean' }).notNull().default(false),
  unlockAll: integer('unlock_all', { mode: 'boolean' }).notNull().default(false),
  xp: integer('xp').notNull().default(0),
  coins: integer('coins').notNull().default(0),
  streak: integer('streak').notNull().default(0),
  longestStreak: integer('longest_streak').notNull().default(0),
  lastActiveDay: text('last_active_day'),
  streakFreezes: integer('streak_freezes').notNull().default(0),
  dailyGoal: integer('daily_goal').notNull().default(30),
  leagueTier: integer('league_tier').notNull().default(0),
  theme: text('theme').notNull().default('default'),
  frame: text('frame'),
  soundOn: integer('sound_on', { mode: 'boolean' }).notNull().default(true),
  /** Wochenrückblick als Push (nur wenn Mitteilungen aktiv sind) */
  weeklyRecap: integer('weekly_recap', { mode: 'boolean' }).notNull().default(true),
  activePet: text('active_pet'),
  invitedWith: text('invited_with'),
  /** veraltet (Klartext, nur kurz in 0003) – wird beim Start nach email_enc verschoben und geleert */
  email: text('email'),
  /** E-Mail verschlüsselt (AES-256-GCM, lib/crypto.ts) */
  emailEnc: text('email_enc'),
  /** HMAC der normalisierten E-Mail – zum Suchen (Login, Passwort vergessen), eindeutig */
  emailHash: text('email_hash'),
  emailVerifiedAt: integer('email_verified_at'),
  /** Google-Konto („sub“ aus dem ID-Token) */
  googleSub: text('google_sub'),
  /** false bei reinen Google-Konten (Passwort-Hash ist dann ein unbenutzbarer Zufallswert) */
  hasPassword: integer('has_password', { mode: 'boolean' }).notNull().default(true),
  /** true = Newsletter bestätigt (Double-Opt-in) */
  newsletter: integer('newsletter', { mode: 'boolean' }).notNull().default(false),
  /** Zeitpunkt der Bestätigung (Nachweis der Einwilligung) */
  newsletterAt: integer('newsletter_at'),
  /** Anmeldung angefordert, Bestätigung steht aus */
  newsletterRequestedAt: integer('newsletter_requested_at'),
  /** Datenschutzerklärung bei der Registrierung bestätigt */
  privacyAcceptedAt: integer('privacy_accepted_at'),
  createdAt: ts('created_at'),
}, (t) => [uniqueIndex('users_email_hash_idx').on(t.emailHash), uniqueIndex('users_google_sub_idx').on(t.googleSub)]);

/** Einmal-Tokens für Links in E-Mails – gespeichert wird nur der SHA-256 */
export const authTokens = sqliteTable(
  'auth_tokens',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['verify', 'reset', 'newsletter'] }).notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    /** Ziel-Adresse (verschlüsselt) bzw. App-URL für die Weiterleitung */
    meta: text('meta', { mode: 'json' }).$type<{ app?: string }>().notNull().default(sql`'{}'`),
    expiresAt: integer('expires_at').notNull(),
    usedAt: integer('used_at'),
    createdAt: ts('created_at'),
  },
  (t) => [index('auth_tokens_user_idx').on(t.userId)],
);

/** Newsletter-Ausgaben (Entwurf → versendet), verwaltet über den Telegram-Bot */
export const newsletterIssues = sqliteTable('newsletter_issues', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  subject: text('subject').notNull(),
  format: text('format', { enum: ['md', 'html', 'txt'] }).notNull().default('md'),
  source: text('source').notNull().default(''),
  status: text('status', { enum: ['draft', 'sending', 'sent'] }).notNull().default('draft'),
  recipients: integer('recipients').notNull().default(0),
  failed: integer('failed').notNull().default(0),
  createdAt: ts('created_at'),
  sentAt: integer('sent_at'),
});

/** WebAuthn-Passkeys (Login ohne Passwort, Safari/PWA) */
export const passkeys = sqliteTable(
  'passkeys',
  {
    /** Credential-ID (base64url) */
    id: text('id').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    /** COSE-Public-Key (base64url) */
    publicKey: text('public_key').notNull(),
    counter: integer('counter').notNull().default(0),
    transports: text('transports', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    name: text('name').notNull(),
    createdAt: ts('created_at'),
    lastUsedAt: integer('last_used_at'),
  },
  (t) => [index('passkeys_user_idx').on(t.userId)],
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tokenHash: text('token_hash').notNull().unique(),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    userAgent: text('user_agent'),
    createdAt: ts('created_at'),
    lastSeenAt: ts('last_seen_at'),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const invites = sqliteTable('invites', {
  code: text('code').primaryKey(),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  note: text('note'),
  maxUses: integer('max_uses').notNull().default(1),
  uses: integer('uses').notNull().default(0),
  revoked: integer('revoked', { mode: 'boolean' }).notNull().default(false),
  expiresAt: integer('expires_at'),
  createdAt: ts('created_at'),
});

// ---------- Inhalte ----------
export const units = sqliteTable(
  'units',
  {
    id: text('id').primaryKey(),
    module: text('module').notNull(),
    number: integer('number').notNull(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    concepts: text('concepts', { mode: 'json' }).$type<string[]>().notNull(),
    keyFacts: text('key_facts', { mode: 'json' }).$type<string[]>().notNull(),
    tags: text('tags', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    /** per [[Wikilink]] verlinkte Notizen (Konzeptgraph) */
    links: text('links', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    sourceFile: text('source_file').notNull(),
    sourceSha: text('source_sha').notNull(),
    contentHash: text('content_hash').notNull(),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  (t) => [uniqueIndex('units_module_number').on(t.module, t.number)],
);

export const levels = sqliteTable(
  'levels',
  {
    id: text('id').primaryKey(),
    unitId: text('unit_id').notNull().references(() => units.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
  },
  (t) => [index('levels_unit_idx').on(t.unitId)],
);

export const questions = sqliteTable(
  'questions',
  {
    id: text('id').primaryKey(),
    levelId: text('level_id').notNull().references(() => levels.id, { onDelete: 'cascade' }),
    unitId: text('unit_id').notNull(),
    position: integer('position').notNull(),
    type: text('type').notNull(),
    /** komplette Frage als JSON (Format aus @lernquest/shared) */
    data: text('data', { mode: 'json' }).notNull(),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    /** von Admin deaktiviert -> Import überschreibt das nicht */
    disabledByAdmin: integer('disabled_by_admin', { mode: 'boolean' }).notNull().default(false),
    updatedAt: ts('updated_at'),
  },
  (t) => [index('questions_level_idx').on(t.levelId)],
);

// ---------- Fortschritt ----------
export const levelProgress = sqliteTable(
  'level_progress',
  {
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    levelId: text('level_id').notNull(),
    completions: integer('completions').notNull().default(0),
    bestAccuracy: integer('best_accuracy').notNull().default(0), // Promille
    stars: integer('stars').notNull().default(0),
    firstDoneAt: integer('first_done_at'),
    lastDoneAt: integer('last_done_at'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.levelId] })],
);

export const answers = sqliteTable(
  'answers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    questionId: text('question_id').notNull(),
    correct: integer('correct', { mode: 'boolean' }).notNull(),
    context: text('context', { enum: ['level', 'practice', 'weak', 'exam', 'duel'] }).notNull(),
    createdAt: ts('created_at'),
  },
  (t) => [index('answers_user_idx').on(t.userId)],
);

export const reviewItems = sqliteTable(
  'review_items',
  {
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    questionId: text('question_id').notNull(),
    box: integer('box').notNull().default(1),
    dueDay: text('due_day').notNull(),
    updatedAt: ts('updated_at'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.questionId] })],
);

/** Karteikarten aus der Wissenssammlung: Leitner-Box je Eintrag (entryId z. B. ds-03-k07) */
export const cardItems = sqliteTable(
  'card_items',
  {
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    entryId: text('entry_id').notNull(),
    unitId: text('unit_id').notNull(),
    module: text('module').notNull(),
    /** 1–5 wie die Wiederholung, 6 = gemeistert (kommt alle 30 Tage wieder) */
    box: integer('box').notNull().default(1),
    dueDay: text('due_day').notNull(),
    reviews: integer('reviews').notNull().default(0),
    lapses: integer('lapses').notNull().default(0),
    updatedAt: ts('updated_at'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.entryId] }), index('card_items_due').on(t.userId, t.module, t.dueDay)],
);

export const xpEvents = sqliteTable(
  'xp_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    amount: integer('amount').notNull(),
    module: text('module'),
    source: text('source').notNull(),
    day: text('day').notNull(),
    createdAt: ts('created_at'),
  },
  (t) => [index('xp_user_day').on(t.userId, t.day), index('xp_created').on(t.createdAt)],
);

/** Vom Server zusammengestellte Fragerunden (Schwächen, Klausur-Check, Duell): nur genau diese Fragen werden gewertet, genau einmal. */
export const quizRuns = sqliteTable(
  'quiz_runs',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['weak', 'exam', 'duel'] }).notNull(),
    module: text('module'),
    questionIds: text('question_ids', { mode: 'json' }).$type<string[]>().notNull(),
    duelId: text('duel_id'),
    startedAt: ts('started_at'),
    completedAt: integer('completed_at'),
    correct: integer('correct'),
    total: integer('total'),
    durationSec: integer('duration_sec'),
  },
  (t) => [index('quiz_runs_user_idx').on(t.userId, t.kind), index('quiz_runs_duel_idx').on(t.duelId)],
);

export const duels = sqliteTable(
  'duels',
  {
    id: text('id').primaryKey(),
    module: text('module').notNull(),
    questionIds: text('question_ids', { mode: 'json' }).$type<string[]>().notNull(),
    challengerId: integer('challenger_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    opponentId: integer('opponent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['open', 'done', 'declined', 'expired'] }).notNull().default('open'),
    winnerId: integer('winner_id'),
    createdAt: ts('created_at'),
    expiresAt: integer('expires_at').notNull(),
    finishedAt: integer('finished_at'),
  },
  (t) => [index('duels_challenger_idx').on(t.challengerId), index('duels_opponent_idx').on(t.opponentId)],
);

export const questClaims = sqliteTable(
  'quest_claims',
  {
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    day: text('day').notNull(),
    questId: text('quest_id').notNull(),
    coins: integer('coins').notNull(),
    claimedAt: ts('claimed_at'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day, t.questId] })],
);

// ---------- Ökonomie ----------
export const userPets = sqliteTable(
  'user_pets',
  {
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    petId: text('pet_id').notNull(),
    xp: integer('xp').notNull().default(0),
    accessory: text('accessory'),
    acquiredAt: ts('acquired_at'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.petId] })],
);

export const inventory = sqliteTable(
  'inventory',
  {
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    itemId: text('item_id').notNull(),
    qty: integer('qty').notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.userId, t.itemId] })],
);

export const purchases = sqliteTable('purchases', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  itemId: text('item_id').notNull(),
  price: integer('price').notNull(),
  createdAt: ts('created_at'),
});

export const leagueWeeks = sqliteTable('league_weeks', {
  weekStart: text('week_start').primaryKey(),
  processedAt: ts('processed_at'),
  result: text('result', { mode: 'json' }),
});

// ---------- Moderation / Admin ----------
export const questionReports = sqliteTable('question_reports', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  questionId: text('question_id').notNull(),
  reason: text('reason').notNull(),
  comment: text('comment'),
  status: text('status', { enum: ['open', 'resolved', 'dismissed'] }).notNull().default('open'),
  resolvedBy: integer('resolved_by'),
  resolvedAt: integer('resolved_at'),
  createdAt: ts('created_at'),
});

export const adminNotifications = sqliteTable('admin_notifications', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  level: text('level', { enum: ['info', 'warn', 'error'] }).notNull().default('info'),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  read: integer('read', { mode: 'boolean' }).notNull().default(false),
  createdAt: ts('created_at'),
});

export const pushSubscriptions = sqliteTable('push_subscriptions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  lastRemindedDay: text('last_reminded_day'),
  /** Montag der Woche, für die der Wochenrückblick schon ging (YYYY-MM-DD) */
  lastRecapWeek: text('last_recap_week'),
  createdAt: ts('created_at'),
});

// ---------- Pipeline ----------
export const pipelineState = sqliteTable('pipeline_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: ts('updated_at'),
});

export const processedFiles = sqliteTable('processed_files', {
  sha256: text('sha256').primaryKey(),
  path: text('path').notNull(),
  status: text('status', { enum: ['done', 'failed', 'skipped'] }).notNull(),
  unitId: text('unit_id'),
  error: text('error'),
  attempts: integer('attempts').notNull().default(1),
  runId: text('run_id'),
  processedAt: ts('processed_at'),
});

export const pipelineRuns = sqliteTable('pipeline_runs', {
  id: text('id').primaryKey(),
  mode: text('mode').notNull(),
  status: text('status', { enum: ['running', 'success', 'nothing_new', 'partial', 'failed'] }).notNull(),
  startedAt: ts('started_at'),
  finishedAt: integer('finished_at'),
  summary: text('summary'),
  report: text('report', { mode: 'json' }),
});
