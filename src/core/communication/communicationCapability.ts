/**
 * Communication capability — honest delivery + contact resolution.
 *
 * It NEVER reports "sent" unless a real, configured platform actually performs
 * the send. If no platform is configured it returns CAPABILITY_UNAVAILABLE with
 * the reason and what the user must provide, so the mission parks (WAITING_FOR_USER)
 * instead of pretending. Contact resolution returns exact matches; multiple
 * matches => ask; zero => not found. "Send tool called" is never treated as
 * success — the caller must observe a real provider confirmation.
 */

export interface Contact { name: string; identifier: string; }

export type ResolveResult =
  | { status: 'RESOLVED'; contact: Contact }
  | { status: 'AMBIGUOUS'; matches: Contact[] }
  | { status: 'NOT_FOUND' };

/** Exact-then-prefix match against a contact directory. Never guesses. */
export function resolveContact(query: string, directory: Contact[]): ResolveResult {
  const q = query.trim().toLowerCase();
  if (!q) return { status: 'NOT_FOUND' };
  const exact = directory.filter((c) => c.name.toLowerCase() === q);
  if (exact.length === 1) return { status: 'RESOLVED', contact: exact[0] };
  if (exact.length > 1) return { status: 'AMBIGUOUS', matches: exact };
  const prefix = directory.filter((c) => c.name.toLowerCase().startsWith(q));
  if (prefix.length === 1) return { status: 'RESOLVED', contact: prefix[0] };
  if (prefix.length > 1) return { status: 'AMBIGUOUS', matches: prefix };
  return { status: 'NOT_FOUND' };
}

export interface Platform { id: string; label: string; configured: boolean; requiresAuth: boolean; }

/** Platforms Akansha can actually send through right now (configured only). */
export function availablePlatforms(platforms: Platform[]): Platform[] {
  return platforms.filter((p) => p.configured);
}

export type SendOutcome =
  | { status: 'SENT'; platform: string; confirmation: string }
  | { status: 'CAPABILITY_UNAVAILABLE'; platform: string; reason: string; required: string };

/**
 * Attempt a send via an injected transport. The transport MUST return a real
 * provider confirmation string; anything falsy is treated as NOT sent. If the
 * platform is not configured, returns CAPABILITY_UNAVAILABLE (mission parks).
 */
export async function sendFile(
  platform: Platform | undefined,
  to: Contact,
  artifact: string,
  transport: (p: Platform, to: Contact, artifact: string) => Promise<string | null>,
): Promise<SendOutcome> {
  if (!platform || !platform.configured) {
    return {
      status: 'CAPABILITY_UNAVAILABLE',
      platform: platform?.id || 'none',
      reason: platform ? `${platform.label} is not configured/authenticated` : 'no delivery platform is configured',
      required: platform?.requiresAuth ? 'user authorization for that platform' : 'configure a messaging/email platform',
    };
  }
  const confirmation = await transport(platform, to, artifact);
  if (!confirmation) {
    return { status: 'CAPABILITY_UNAVAILABLE', platform: platform.id, reason: 'transport returned no confirmation', required: 'retry or choose another platform' };
  }
  return { status: 'SENT', platform: platform.id, confirmation };
}
