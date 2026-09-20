/**
 * Server-side speech transcription through the EXISTING provider fabric.
 *
 * The packaged desktop app has no system speech service (Electron's
 * webkitSpeechRecognition fails with error 'network'), so the client records a
 * short speech segment and asks Akansha's own providers to transcribe it. This
 * module does NOT create a new provider system: it reuses ProviderManager rows,
 * the CredentialVault, and the same OpenAI-compatible endpoint shape the chat
 * adapter already uses (`{baseUrl}/audio/transcriptions`), plus Gemini's native
 * `generateContent` inline-audio shape.
 *
 * Honesty rules:
 *  - Only enabled providers with a stored credential are candidates.
 *  - A provider is only claimed to work after a REAL HTTP 2xx response.
 *  - Errors are redacted — credentials can never leak through error text/logs.
 */
import { providerManager } from '../providers/ProviderManager';
import { credentialVault } from '../security/CredentialVault';

export type TranscribeCode =
  | 'OK'
  | 'NO_TRANSCRIPTION_PROVIDER'
  | 'AUTH_FAILED'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE'
  | 'UPSTREAM_ERROR'
  | 'EMPTY_AUDIO';

export interface TranscriptionCandidate {
  providerId: string;
  name: string;
  kind: 'openai-audio' | 'gemini-inline';
  baseUrl: string;
  credentialRef: string;
  model: string;
}

export interface TranscriptionResult {
  ok: boolean;
  code: TranscribeCode;
  text?: string;
  providerId?: string;
  model?: string;
  latencyMs?: number;
  /** Redacted, user-safe detail. Never contains credentials. */
  detail?: string;
}

const DEFAULT_OPENAI_ASR_MODEL = 'whisper-large-v3';
const DEFAULT_GEMINI_ASR_MODEL = 'gemini-2.0-flash';

/** Strip anything key-shaped from upstream error text before it reaches UI/logs. */
export function redactSecrets(s: string): string {
  return String(s || '')
    .replace(/(sk-|key[=:"]+|Bearer\s+)[A-Za-z0-9_\-]{8,}/gi, '$1[redacted]')
    .replace(/AIza[0-9A-Za-z_\-]{20,}/g, '[redacted]')
    .slice(0, 200);
}

/**
 * Which configured providers can transcribe audio right now?
 * openai/openai-compatible/custom (e.g. Groq) → OpenAI audio endpoint;
 * gemini → native inline-audio generateContent.
 * ollama/local/openrouter are excluded: they do not serve audio transcription
 * (OpenRouter has no /audio/transcriptions — claiming otherwise would be fake).
 */
export function listCandidates(records: Array<{
  providerId: string; name: string; type: string; baseUrl: string | null;
  enabled: boolean; credentialConfigured: boolean; settings: Record<string, unknown>;
}>): TranscriptionCandidate[] {
  const out: TranscriptionCandidate[] = [];
  for (const r of records) {
    if (!r.enabled || !r.credentialConfigured || !r.baseUrl) continue;
    const base = r.baseUrl.replace(/\/$/, '');
    const model = String(r.settings?.transcriptionModel || '');
    if (r.type === 'gemini') {
      out.push({ providerId: r.providerId, name: r.name, kind: 'gemini-inline', baseUrl: base, credentialRef: '', model: model || DEFAULT_GEMINI_ASR_MODEL });
    } else if (r.type === 'openai' || r.type === 'openai-compatible' || r.type === 'custom') {
      out.push({ providerId: r.providerId, name: r.name, kind: 'openai-audio', baseUrl: base, credentialRef: '', model: model || DEFAULT_OPENAI_ASR_MODEL });
    }
  }
  return out;
}

function httpCode(status: number): TranscribeCode {
  if (status === 401 || status === 403) return 'AUTH_FAILED';
  if (status === 429) return 'RATE_LIMITED';
  return 'UPSTREAM_ERROR';
}

async function callCandidate(c: TranscriptionCandidate, key: string, audio: Buffer, mime: string, timeoutMs: number): Promise<TranscriptionResult> {
  const started = Date.now();
  try {
    if (c.kind === 'openai-audio') {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(audio)], { type: mime }), `speech.${mime.includes('webm') ? 'webm' : mime.includes('ogg') ? 'ogg' : 'wav'}`);
      form.append('model', c.model);
      const res = await fetch(`${c.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: form,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const latencyMs = Date.now() - started;
      if (!res.ok) return { ok: false, code: httpCode(res.status), latencyMs, detail: `${c.name} HTTP ${res.status}: ${redactSecrets(await res.text().catch(() => ''))}` };
      const json = await res.json().catch(() => null);
      const text = String(json?.text ?? '').trim();
      if (!text) return { ok: false, code: 'UPSTREAM_ERROR', latencyMs, detail: `${c.name} returned no transcript text` };
      return { ok: true, code: 'OK', text, providerId: c.providerId, model: c.model, latencyMs };
    }
    // Gemini native inline audio → transcription prompt.
    const res = await fetch(`${c.baseUrl}/models/${c.model}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: mime, data: audio.toString('base64') } },
          { text: 'Transcribe the speech in this audio verbatim. Reply with ONLY the transcript text, no commentary. If there is no intelligible speech, reply with an empty response.' },
        ] }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) return { ok: false, code: httpCode(res.status), latencyMs, detail: `${c.name} HTTP ${res.status}: ${redactSecrets(await res.text().catch(() => ''))}` };
    const json = await res.json().catch(() => null);
    const text = String((json?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('')).trim();
    if (!text) return { ok: true, code: 'OK', text: '', providerId: c.providerId, model: c.model, latencyMs };
    return { ok: true, code: 'OK', text, providerId: c.providerId, model: c.model, latencyMs };
  } catch (e: any) {
    return { ok: false, code: e?.name === 'TimeoutError' ? 'UNAVAILABLE' : 'UNAVAILABLE', latencyMs: Date.now() - started, detail: `${c.name}: ${e?.name === 'TimeoutError' ? 'timeout' : 'unreachable'}` };
  }
}

/**
 * Transcribe one audio segment. Tries every credential-backed candidate in
 * fallback order and returns the FIRST real success. If none exist, the caller
 * gets NO_TRANSCRIPTION_PROVIDER — the UI must show that, never a fake transcript.
 */
export async function transcribeAudio(audio: Buffer, mime: string, opts: { timeoutMs?: number } = {}): Promise<TranscriptionResult> {
  if (!audio || audio.length === 0) return { ok: false, code: 'EMPTY_AUDIO', detail: 'No audio bytes received' };
  const rows = (await providerManager.listRecords()) as unknown as Array<{
    providerId: string; name: string; type: string; baseUrl: string | null;
    enabled: boolean; credentialConfigured: boolean; settings: Record<string, unknown>;
  }>;
  const candidates = listCandidates(rows);
  if (candidates.length === 0) {
    return { ok: false, code: 'NO_TRANSCRIPTION_PROVIDER', detail: 'No provider with a stored API key can transcribe audio. Connect a free Gemini or Groq key in Providers.' };
  }
  let last: TranscriptionResult = { ok: false, code: 'UNAVAILABLE', detail: 'no candidate attempted' };
  for (const c of candidates) {
    // credentialRef stays server-side: read it from the instantiated provider's
    // descriptor (records intentionally never carry it), then resolve via vault.
    const p = providerManager.get(c.providerId);
    const ref = p ? p.descriptor().credentialRef : undefined;
    const key = credentialVault.resolve(ref);
    if (!key) continue;
    last = await callCandidate(c, key, audio, mime, opts.timeoutMs ?? 30000);
    if (last.ok) return last;
    if (last.code === 'RATE_LIMITED' || last.code === 'UNAVAILABLE' || last.code === 'UPSTREAM_ERROR') continue; // try next provider
    if (last.code === 'AUTH_FAILED') continue; // key invalid here — try another provider
  }
  return last.ok ? last : { ...last, code: last.code === 'OK' ? 'UPSTREAM_ERROR' : last.code };
}
