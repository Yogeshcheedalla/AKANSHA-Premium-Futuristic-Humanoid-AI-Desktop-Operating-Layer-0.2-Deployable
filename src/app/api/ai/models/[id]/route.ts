import { NextResponse } from 'next/server';
import { authorize } from '@/core/auth/guard';
import { existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { unregister, readUsable } from '@/core/models/local/LocalModelRegistry';
import { modelsRoot } from '@/app/api/ai/install/execute/route';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/ai/models/{id} — remove an installed model's ARTIFACT to reclaim
 * storage. Strictly path-guarded: only the app's own models-root subfolder for
 * that exact (sanitized) id may be touched. The registry record is
 * unregistered, so READY honestly drops to NOT-INSTALLED immediately.
 * Re-install later is always possible — the signed/user-trusted checksum
 * entry itself is not removed by this action.
 */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = authorize(request, 'sensitive');
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id || '')) return NextResponse.json({ ok: false, error: 'invalid model id' }, { status: 400 });

  const root = resolve(modelsRoot());
  const dir = resolve(join(root, id));
  // Containment: dir must be a DIRECT child of the models root (no traversal).
  if (dir.toLowerCase().startsWith(root.toLowerCase() + sep) === false || resolve(join(dir, '..')) !== root) {
    return NextResponse.json({ ok: false, error: 'path-guard' }, { status: 400 });
  }

  const freed = existsSync(dir) ? dirSize(dir) : 0;
  try {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: 'remove-failed:' + String(e?.message || e) }, { status: 500 });
  }
  unregister(id);
  const stillUsable = readUsable().some((u) => u.id === id);
  return NextResponse.json({ ok: true, removed: freed > 0, freedMB: Math.round(freed / 1e6), stillUsable });
}

function dirSize(dir: string): number {
  let total = 0;
  try {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, f.name);
      total += f.isDirectory() ? dirSize(p) : (statSync(p).size || 0);
    }
  } catch { /* unreadable counts as 0 */ }
  return total;
}
