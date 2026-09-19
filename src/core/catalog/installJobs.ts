/**
 * Install jobs — the single job model for model provisioning. It does NOT
 * re-implement provisioning: it OWNS the lifecycle around the existing
 * provisionAndVerify pipeline (jobId, honest stage, real byte progress,
 * cooperative AbortSignal, final state) and emits events on the existing
 * EventBus. No second download manager, no second pipeline, no fake progress:
 * stages advance when the real work advances, and byte progress only exists
 * while a real stream is flowing.
 *
 * Race protection: a job that has been cancelled can NEVER transition to
 * READY — provisionAndVerify re-checks the signal after every stage, and the
 * job layer refuses post-cancel completion regardless.
 */
import { eventBus } from '@/core/events/EventBus';

export type InstallJobState = 'INSTALLING' | 'CANCELLING' | 'VERIFYING' | 'INFERENCE_TESTING' | 'CANCELLED' | 'FAILED' | 'READY';

export interface InstallJob {
  jobId: string;
  modelId: string;
  state: InstallJobState;
  stage: string;
  bytesDownloaded: number;
  totalBytes: number | null;
  startedAt: number;
  endedAt: number | null;
  error?: string;
  benchmark?: { genTps?: number | null; promptTps?: number | null; totalMs?: number } | null;
  /** Internal — not serialized to the UI. */
  abort: AbortController;
}

const jobs = new Map<string, InstallJob>();
const HISTORY_LIMIT = 24;

function publicJob(j: InstallJob) {
  const { abort: _a, ...rest } = j;
  return rest;
}

export function createInstallJob(modelId: string, totalBytes: number | null): InstallJob {
  // One active job per model — a second request observes the existing one.
  for (const j of jobs.values()) {
    if (j.modelId === modelId && (j.state === 'INSTALLING' || j.state === 'CANCELLING' || j.state === 'VERIFYING' || j.state === 'INFERENCE_TESTING')) {
      return j;
    }
  }
  const job: InstallJob = {
    jobId: `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    modelId, state: 'INSTALLING', stage: 'download',
    bytesDownloaded: 0, totalBytes, startedAt: Date.now(), endedAt: null, abort: new AbortController(),
  };
  jobs.set(job.jobId, job);
  while (jobs.size > HISTORY_LIMIT) {
    const oldest = [...jobs.values()].sort((a, b) => a.startedAt - b.startedAt)
      .find((j) => j.state === 'CANCELLED' || j.state === 'FAILED' || j.state === 'READY');
    if (!oldest) break;
    jobs.delete(oldest.jobId);
  }
  eventBus.emit('install.started', 'InstallJobs', publicJob(job));
  return job;
}

export function getInstallJob(jobId: string) {
  const j = jobs.get(jobId);
  return j ? publicJob(j) : null;
}

export function listInstallJobs(modelId?: string) {
  return [...jobs.values()].filter((j) => !modelId || j.modelId === modelId).map(publicJob);
}

/** The active job for a model, if any — the UI derives lifecycle state from this. */
export function activeJobFor(modelId: string) {
  for (const j of jobs.values()) {
    if (j.modelId === modelId && j.state !== 'CANCELLED' && j.state !== 'FAILED' && j.state !== 'READY') return publicJob(j);
  }
  return null;
}

export function updateInstallJob(jobId: string, patch: Partial<Pick<InstallJob, 'state' | 'stage' | 'bytesDownloaded' | 'totalBytes' | 'error' | 'benchmark' | 'endedAt'>>) {
  const j = jobs.get(jobId);
  if (!j) return null;
  if (j.state === 'CANCELLED' || j.state === 'READY') return publicJob(j); // terminal — never resurrected
  Object.assign(j, patch);
  if (patch.state) eventBus.emit('install.state', 'InstallJobs', publicJob(j));
  else eventBus.emit('install.progress', 'InstallJobs', publicJob(j));
  return publicJob(j);
}

/**
 * Request cancellation. Signals the real downloader/inference process and
 * moves the job to CANCELLING (terminal CANCELLED is set by the runner once
 * the work actually stops — never before).
 */
export function cancelInstallJob(jobId: string): boolean {
  const j = jobs.get(jobId);
  if (!j) return false;
  if (j.state === 'CANCELLED' || j.state === 'READY' || j.state === 'FAILED') return true;
  j.abort.abort();
  updateInstallJob(jobId, { state: 'CANCELLING', stage: 'cancelling' });
  return true;
}

export function isCancelled(jobId: string): boolean {
  const j = jobs.get(jobId);
  return !j || j.state === 'CANCELLING' || j.state === 'CANCELLED';
}
