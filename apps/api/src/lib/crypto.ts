import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Schutz personenbezogener Daten in der Datenbank:
 * - E-Mail-Adressen liegen nur verschlüsselt vor (AES-256-GCM, Schlüssel DATA_KEY aus .env)
 * - gesucht wird über einen geschlüsselten Hash (HMAC-SHA256, EMAIL_HASH_KEY) – ohne Schlüssel nicht umkehrbar
 * - Einmal-Tokens (Passwort-Reset, Bestätigungen) speichern wir nur als SHA-256
 * Passwörter: Argon2id (lib/auth.ts). Ein Datenbank-Dump allein verrät also weder Adressen noch Passwörter.
 */

function key(name: 'DATA_KEY' | 'EMAIL_HASH_KEY'): Buffer {
  const raw = process.env[name]?.trim();
  if (raw) {
    const k = Buffer.from(raw, 'base64');
    if (k.length !== 32) throw new Error(`${name} muss 32 Byte (base64) lang sein`);
    return k;
  }
  // Tests/Entwicklung: fester Schlüssel pro Prozess. In Produktion muss er in .env stehen.
  if (process.env.NODE_ENV === 'production') throw new Error(`${name} fehlt in .env`);
  return createHash('sha256').update(`lernquest-dev-${name}`).digest();
}

/** AES-256-GCM → "v1.<iv>.<tag>.<ciphertext>" (base64url) */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key('DATA_KEY'), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function decrypt(box: string | null | undefined): string | null {
  if (!box) return null;
  const [v, iv, tag, data] = box.split('.');
  if (v !== 'v1' || !iv || !tag || !data) return null;
  try {
    const d = createDecipheriv('aes-256-gcm', key('DATA_KEY'), Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export const normalizeEmail = (e: string) => e.trim().toLowerCase();

/** Suchschlüssel für eine E-Mail-Adresse (eindeutig, ohne EMAIL_HASH_KEY nicht zurückzurechnen) */
export const emailHash = (email: string) => createHmac('sha256', key('EMAIL_HASH_KEY')).update(normalizeEmail(email)).digest('hex');

/** Zufälliger Einmal-Token; in der DB landet nur `hash` */
export function newToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: tokenHash(token) };
}
export const tokenHash = (t: string) => createHash('sha256').update(t).digest('hex');

/** Signatur für Links ohne gespeicherten Token (Newsletter abmelden) */
export const sign = (value: string) => createHmac('sha256', key('EMAIL_HASH_KEY')).update(`sig:${value}`).digest('base64url').slice(0, 32);
export function verifySig(value: string, sig: string) {
  const a = Buffer.from(sign(value));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Adresse maskiert anzeigen: ma•••@gmail.com */
export function maskEmail(e: string | null) {
  if (!e) return null;
  const [local = '', domain = ''] = e.split('@');
  return `${local.slice(0, 2)}${'•'.repeat(Math.max(1, Math.min(5, local.length - 2)))}@${domain}`;
}
