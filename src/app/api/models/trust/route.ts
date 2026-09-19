import { NextResponse } from 'next/server';
import { authorize } from '@/core/auth/guard';
import { trustModelRepo, readUserCatalog, untrustModel } from '@/core/models/local/userCatalog';

export const dynamic = 'force-dynamic';

/**
 * Model trust — the user-approved install path for discovered GGUF repos that
 * are outside the operator-signed catalog. The pinned checksum is the file's
 * REAL HuggingFace LFS SHA-256 (never inferred); installation afterwards still
 * runs the same integrity → real-inference → READY pipeline. GET lists the
 * local trust store; DELETE removes an approval (artifacts untouched).
 */
export async function POST(request: Request) {
  const guard = authorize(request, 'sensitive');
  if (!guard.ok) return guard.response;
  try {
    const body = await request.json().catch(() => ({}));
    const repo = String(body?.repo || '');
    const file = body?.file ? String(body.file) : undefined;
    const r = await trustModelRepo(repo, file ? { file } : {});
    if (!r.ok) return NextResponse.json({ ok: false, error: r.reason }, { status: 400 });
    return NextResponse.json({ ok: true, modelId: r.entry!.id, file: r.selectedFile, sizeBytes: r.entry!.downloadSizeBytes, sha256: r.entry!.sha256.slice(0, 16) + '…' });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'trust failed' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const guard = authorize(request, 'authenticated');
  if (!guard.ok) return guard.response;
  return NextResponse.json({ ok: true, models: readUserCatalog().map((m) => ({ id: m.id, sourceUrl: m.sourceUrl, sizeBytes: m.downloadSizeBytes, license: m.license })) });
}

export async function DELETE(request: Request) {
  const guard = authorize(request, 'sensitive');
  if (!guard.ok) return guard.response;
  const body = await request.json().catch(() => ({}));
  const id = String(body?.modelId || '');
  if (!id) return NextResponse.json({ ok: false, error: 'modelId required' }, { status: 400 });
  untrustModel(id);
  return NextResponse.json({ ok: true });
}
