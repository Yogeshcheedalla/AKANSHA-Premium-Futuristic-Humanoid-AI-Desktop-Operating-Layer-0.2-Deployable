import { NextResponse } from 'next/server';
import { authorize } from '@/core/auth/guard';
import { taskManager } from '@/core/tasks/TaskManager';

export const dynamic = 'force-dynamic';

/** GET /api/tasks — the real durable task list (state survives chat + restart). */
export async function GET(request: Request) {
  const guard = authorize(request, 'authenticated');
  if (!guard.ok) return guard.response;
  return NextResponse.json({ ok: true, tasks: taskManager.list() });
}

/** POST /api/tasks { taskId, action:'cancel' } — explicit cancellation only. */
export async function POST(request: Request) {
  const guard = authorize(request, 'authenticated');
  if (!guard.ok) return guard.response;
  try {
    const body = await request.json().catch(() => ({}));
    const taskId = String(body?.taskId || '');
    if (body?.action === 'cancel' && taskId) {
      const t = taskManager.cancel(taskId);
      return NextResponse.json({ ok: !!t, task: t });
    }
    return NextResponse.json({ ok: false, error: 'unknown action' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'task op failed' }, { status: 500 });
  }
}
