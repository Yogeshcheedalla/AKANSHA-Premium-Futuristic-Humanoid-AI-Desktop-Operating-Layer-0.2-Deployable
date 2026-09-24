/**
 * Fabric observability — a bounded, in-memory trace of every routed inference
 * attempt. Spec item #13: record requestId, provider, model, route, attempt,
 * latency, status, failure reason, failover count, token usage (real when the
 * provider reports it, otherwise an honest estimate), cost tier, and local/cloud.
 *
 * Security rule: NEVER store API keys, raw request bodies, or message content.
 * Only routing metadata + failure classifications live here. This is a
 * diagnostic ring buffer, not a conversation log.
 */
import type { RouteHealthState } from '../routing/routeHealth';

export type AttemptStatus = 'success' | 'failure';

export interface FabricTraceRecord {
  requestId: string;
  providerId: string;
  modelId: string;
  attempt: number;
  status: AttemptStatus;
  latencyMs: number;
  failureReason?: string;
  routeHealth?: RouteHealthState;
  failoverCount: number;
  costTier: 'local' | 'free' | 'paid' | 'unknown';
  local: boolean;
  tokenUsage?: { prompt: number; completion: number; total: number };
  tokenUsageEstimated?: boolean;
  at: number;
}

export interface RequestSummary {
  requestId: string;
  finalProviderId: string | null;
  finalModelId: string | null;
  attempts: number;
  failoverCount: number;
  succeeded: boolean;
  totalLatencyMs: number;
  route: 'local' | 'free' | 'paid' | 'unknown';
  finishedAt: number;
}

const MAX_RECORDS = 500;

class FabricTrace {
  private records: FabricTraceRecord[] = [];

  record(rec: FabricTraceRecord): void {
    this.records.push(rec);
    if (this.records.length > MAX_RECORDS) this.records.splice(0, this.records.length - MAX_RECORDS);
  }

  /** Most-recent-first snapshot for the dashboard. */
  recent(limit = 50): FabricTraceRecord[] {
    return this.records.slice(-limit).reverse();
  }

  /** Per-request aggregation: how many failovers were needed to get an answer. */
  summary(requestId: string): RequestSummary | null {
    const rs = this.records.filter((r) => r.requestId === requestId);
    if (rs.length === 0) return null;
    const succ = rs.filter((r) => r.status === 'success');
    const last = succ.length ? succ[succ.length - 1] : rs[rs.length - 1];
    const failovers = rs.filter((r) => r.status === 'failure').length;
    return {
      requestId,
      finalProviderId: succ.length ? last.providerId : null,
      finalModelId: succ.length ? last.modelId : null,
      attempts: rs.length,
      failoverCount: failovers,
      succeeded: succ.length > 0,
      totalLatencyMs: rs.reduce((n, r) => n + r.latencyMs, 0),
      route: last.costTier === 'unknown' ? 'unknown' : last.costTier === 'local' ? 'local' : last.costTier === 'free' ? 'free' : 'paid',
      finishedAt: last.at,
    };
  }

  /** Aggregate failover rate across the window (how often we had to switch routes). */
  failoverStats(): { requests: number; requestsWithFailover: number; failuresByHealth: Record<string, number> } {
    const byReq = new Map<string, FabricTraceRecord[]>();
    for (const r of this.records) {
      const arr = byReq.get(r.requestId) || [];
      arr.push(r);
      byReq.set(r.requestId, arr);
    }
    let withFailover = 0;
    const failuresByHealth: Record<string, number> = {};
    for (const [, arr] of byReq) {
      if (arr.some((a) => a.status === 'failure')) withFailover += 1;
      for (const a of arr) {
        if (a.status === 'failure' && a.routeHealth) {
          failuresByHealth[a.routeHealth] = (failuresByHealth[a.routeHealth] || 0) + 1;
        }
      }
    }
    return { requests: byReq.size, requestsWithFailover: withFailover, failuresByHealth };
  }

  clear(): void { this.records = []; }
}

export const fabricTrace = new FabricTrace();

/** Redact anything key-shaped before it could ever reach a trace/log line. */
export function redactSecrets(text: string): string {
  return String(text || '')
    .replace(/(sk-[a-z0-9_\-]{8,})/gi, 'sk-***redacted***')
    .replace(/(Bearer\s+)[a-z0-9._\-]{8,}/gi, '$1***redacted***')
    .slice(0, 200);
}
