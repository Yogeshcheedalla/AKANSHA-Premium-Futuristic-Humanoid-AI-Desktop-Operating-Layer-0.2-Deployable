import { db } from '@/db';
import { actionExecutions } from '@/db/schema';
import type { ActionRequest, ActionResult } from '@/core/actions/types';

/** Pure mapping of a request+result to a durable row (no DB, no secrets). */
export function toExecutionRow(req: ActionRequest, r: ActionResult) {
  return {
    requestId: r.requestId,
    actionId: r.actionId,
    userId: req.userId ?? null,
    missionId: req.missionId ?? null,
    status: r.status,
    verified: r.verification?.verified ?? false,
    // Evidence is a non-secret summary + ids; never store tokens/keys.
    evidence: r.evidence ? { kind: r.evidence.kind, summary: r.evidence.summary, data: r.evidence.data ?? {} } : {},
    failure: r.failure ?? null,
    startedAt: new Date(r.startedAt),
    completedAt: r.completedAt ? new Date(r.completedAt) : null,
  };
}

/**
 * Best-effort durable persistence of an action outcome. When no database is
 * configured (offline/desktop) or the write fails, it degrades silently and
 * returns false — the fabric still returns the truthful result; persistence is
 * additive, never a hard dependency.
 */
export async function persistActionExecution(
  req: ActionRequest,
  r: ActionResult,
  client: any = db,
): Promise<boolean> {
  try {
    await client.insert(actionExecutions).values(toExecutionRow(req, r)).onConflictDoNothing();
    return true;
  } catch {
    return false;
  }
}
