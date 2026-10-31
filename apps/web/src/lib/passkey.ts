import { browserSupportsWebAuthn, browserSupportsWebAuthnAutofill, startAuthentication, startRegistration, WebAuthnAbortService } from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { api } from './api.ts';
import { isNative } from './native.ts';

/**
 * Passkeys gehören zur Domain lern.varialbe.xyz. Safari und die Home-Screen-App können sie nutzen.
 * Die iOS-App (capacitor://localhost, signiert über LiveContainer/eigene Apple-ID) bräuchte dafür
 * Associated Domains – das geht mit einem kostenlosen Account nicht. Dort bleibt der Passwort-Login.
 */
export const passkeysSupported = () => !isNative && browserSupportsWebAuthn();

type Started<T> = { challengeId: string; options: T };

/** Anmelden. `autofill`: als Vorschlag im Benutzernamen-Feld (Conditional UI), wartet still im Hintergrund. */
export async function loginWithPasskey(autofill = false): Promise<string> {
  const { challengeId, options } = await api<Started<PublicKeyCredentialRequestOptionsJSON>>('/api/auth/passkey/options', { method: 'POST', body: {} });
  const response = await startAuthentication({ optionsJSON: options, useBrowserAutofill: autofill });
  const r = await api<{ token: string }>('/api/auth/passkey/login', { method: 'POST', body: { challengeId, response } });
  return r.token;
}

export async function autofillAvailable() {
  return passkeysSupported() && (await browserSupportsWebAuthnAutofill().catch(() => false));
}

export const cancelPasskeyAutofill = () => WebAuthnAbortService.cancelCeremony();

/** Neuen Passkey für den eingeloggten Account anlegen (iCloud-Schlüsselbund / Passwörter-App) */
export async function addPasskey(name: string) {
  const { challengeId, options } = await api<Started<PublicKeyCredentialCreationOptionsJSON>>('/api/me/passkeys/options', { method: 'POST', body: {} });
  const response = await startRegistration({ optionsJSON: options });
  await api('/api/me/passkeys', { method: 'POST', body: { challengeId, response, name } });
}

/** Abbruch durch den Nutzer nicht als Fehler anzeigen */
export const isCancel = (e: unknown) => e instanceof Error && (e.name === 'NotAllowedError' || e.name === 'AbortError' || /abort|cancel/i.test(e.message));

/** Lesbare Fehlermeldung */
export function passkeyError(e: unknown): string {
  if (e instanceof Error && e.name === 'InvalidStateError') return 'Für dieses Gerät ist schon ein Passkey hinterlegt.';
  return e instanceof Error ? e.message : 'Passkey fehlgeschlagen.';
}
