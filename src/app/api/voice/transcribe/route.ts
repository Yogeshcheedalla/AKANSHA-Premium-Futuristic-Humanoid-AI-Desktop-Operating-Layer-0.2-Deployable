import { NextResponse } from 'next/server';
import { authorize } from '@/core/auth/guard';
import { transcribeAudio } from '@/core/voice/transcription';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB cap — voice segments are tiny; never an open upload gate.

/**
 * POST /api/voice/transcribe — server-side ASR for the packaged desktop app
 * (which has no system speech service). Accepts one recorded speech segment
 * (multipart field "audio" or a raw binary body) and returns the transcript
 * from the EXISTING provider fabric. Status codes are truthful:
 *  200 transcript | 503 NO_TRANSCRIPTION_PROVIDER | 429 RATE_LIMITED |
 *  401/403 AUTH_FAILED | 502 UPSTREAM_ERROR | 413 too large | 400 empty.
 * Audio bytes are transient — never stored, never logged.
 */
export async function POST(request: Request) {
  const guard = authorize(request, 'authenticated');
  if (!guard.ok) return guard.response;

  try {
    let bytes: Uint8Array | null = null;
    let mime = 'audio/webm';

    const ct = request.headers.get('content-type') || '';
    if (ct.includes('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('audio');
      if (file instanceof File) {
        bytes = new Uint8Array(await file.arrayBuffer());
        if (file.type) mime = file.type;
      }
    } else if (!ct.includes('application/json')) {
      const buf = await request.arrayBuffer();
      bytes = new Uint8Array(buf);
      const reqMime = ct.split(';')[0].trim();
      if (reqMime.startsWith('audio/')) mime = reqMime;
    }

    if (!bytes || bytes.length === 0) {
      return NextResponse.json({ ok: false, code: 'EMPTY_AUDIO', detail: 'No audio received' }, { status: 400 });
    }
    if (bytes.length > MAX_BYTES) {
      return NextResponse.json({ ok: false, code: 'TOO_LARGE', detail: 'Audio segment exceeds 25 MB' }, { status: 413 });
    }

    const result = await transcribeAudio(Buffer.from(bytes), mime, { allowCloud: process.env.AKANSHA_ASR_ALLOW_CLOUD === 'true' });
    if (result.ok) {
      return NextResponse.json({ ok: true, text: result.text, provider: result.providerId, model: result.model, latencyMs: result.latencyMs, local: result.local ?? false, asrMode: result.asrMode ?? null });
    }
    const status =
      result.code === 'NO_TRANSCRIPTION_PROVIDER' || result.code === 'EMPTY_AUDIO' || result.code.startsWith('LOCAL_STT_') ? 503 :
      result.code === 'RATE_LIMITED' ? 429 :
      result.code === 'AUTH_FAILED' ? 401 :
      result.code === 'UNAVAILABLE' ? 502 : 502;
    return NextResponse.json({ ok: false, code: result.code, detail: result.detail }, { status });
  } catch (e: any) {
    return NextResponse.json({ ok: false, code: 'UPSTREAM_ERROR', detail: String(e?.message || 'transcribe failed').slice(0, 200) }, { status: 500 });
  }
}
