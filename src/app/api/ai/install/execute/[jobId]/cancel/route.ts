import { NextResponse } from 'next/server';
import { authorize } from '@/core/auth/guard';
import { cancelInstallJob, getInstallJob } from '@/core/catalog/installJobs';

export const dynamic = 'force-dynamic';

/**
 * POST /api/ai/install/execute/{jobId}/cancel
 * Real cancellation: signals the actual downloader stream and inference
 * subprocess, moves the job to CANCELLING, and the runner finalizes CANCELLED
 * once the work has actually stopped (terminal states are never resurrected —
 * a cancelled job cannot become READY, and partial .part files are deleted).
 */
export async function POST(request: Request, ctx: { params: Promise<{ jobId: string }> }) {
  const guard = authorize(request, 'sensitive');
  if (!guard.ok) return guard.response;
  const { jobId } = await ctx.params;
  const before = getInstallJob(jobId);
  if (!before) return NextResponse.json({ ok: false, error: 'job-not-found' }, { status: 404 });
  const accepted = cancelInstallJob(jobId);
  return NextResponse.json({ ok: accepted, job: getInstallJob(jobId) });
}
