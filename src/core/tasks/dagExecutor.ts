/**
 * DAG executor — runs a subtask graph with dependency ordering, executing
 * independent branches CONCURRENTLY and dependent ones only after their
 * prerequisites. A failed dependency marks its dependents SKIPPED (so one dead
 * branch does not silently produce false success downstream), while independent
 * branches keep running. Pure scheduler + an injected executor make it testable.
 */
import type { Subtask } from './goalPlanner';

export type SubStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
export interface SubResult { id: string; status: SubStatus; evidence?: string; error?: string; }

/** Topological waves: each wave's subtasks are mutually independent. */
export function waves(subtasks: Subtask[]): string[][] {
  const byId = new Map(subtasks.map((s) => [s.id, s]));
  const level = new Map<string, number>();
  const depth = (id: string, seen = new Set<string>()): number => {
    if (level.has(id)) return level.get(id)!;
    if (seen.has(id)) return 0; // cycle guard — treat as level 0
    seen.add(id);
    const s = byId.get(id);
    const deps = (s?.dependsOn || []).filter((d) => byId.has(d));
    const d = deps.length ? 1 + Math.max(...deps.map((x) => depth(x, seen))) : 0;
    level.set(id, d);
    return d;
  };
  subtasks.forEach((s) => depth(s.id));
  const out: string[][] = [];
  for (const s of subtasks) {
    const l = level.get(s.id) || 0;
    (out[l] ||= []).push(s.id);
  }
  return out.filter(Boolean);
}

export interface RunOptions { parallel?: boolean; }

/**
 * Execute the graph. `runOne` performs a single subtask (injected so tests use
 * fakes and production uses the Action Fabric). Independent subtasks within a
 * wave run concurrently when parallel !== false.
 */
export async function runDag(
  subtasks: Subtask[],
  runOne: (s: Subtask) => Promise<SubResult>,
  opts: RunOptions = {},
): Promise<Map<string, SubResult>> {
  const parallel = opts.parallel !== false;
  const byId = new Map(subtasks.map((s) => [s.id, s]));
  const results = new Map<string, SubResult>();
  for (const wave of waves(subtasks)) {
    const ready = wave.filter((id) => (byId.get(id)?.dependsOn || []).every((d) => results.get(d)?.status === 'COMPLETED'));
    const blocked = wave.filter((id) => !ready.includes(id));
    for (const id of blocked) {
      const failedDep = (byId.get(id)?.dependsOn || []).find((d) => results.get(d)?.status !== 'COMPLETED');
      results.set(id, { id, status: 'SKIPPED', error: `dependency ${failedDep || '?'} did not complete` });
    }
    if (parallel) {
      const rs = await Promise.all(ready.map(async (id) => runOne(byId.get(id)!)));
      rs.forEach((r) => results.set(r.id, r));
    } else {
      for (const id of ready) results.set(id, await runOne(byId.get(id)!));
    }
  }
  return results;
}
