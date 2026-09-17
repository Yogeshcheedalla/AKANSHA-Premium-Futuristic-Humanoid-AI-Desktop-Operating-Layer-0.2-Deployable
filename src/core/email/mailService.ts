/**
 * Akansha mail service — ONE authoritative, SERVER-ONLY SMTP transporter.
 *
 * - SMTP is transactional email (welcome / login / security / system notices). It is
 *   NOT an authentication mechanism — Google remains the only identity provider.
 * - Credentials come only from server env (SMTP_*). They are NEVER returned, logged,
 *   embedded in errors, or exposed to the browser/renderer.
 * - If SMTP is not configured, every send honestly returns NOT CONFIGURED; if the
 *   nodemailer transport is unavailable, TRANSPORT_UNAVAILABLE. Nothing is faked, and
 *   a failed email NEVER blocks Google authentication (callers treat it separately).
 * - TLS: port 465 = implicit TLS (secure:true); port 587 = STARTTLS (secure:false +
 *   requireTLS:true). TLS verification is never disabled.
 */
export interface SmtpConfig {
  host?: string; port: number; secure: boolean; user?: string; pass?: string;
  from?: string; fromName?: string; replyTo?: string;
}

export function smtpConfig(env: NodeJS.ProcessEnv = process.env): SmtpConfig {
  const port = Number(env.SMTP_PORT || (String(env.SMTP_SECURE) === 'false' ? 587 : 465));
  const secure = env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465;
  return {
    host: env.SMTP_HOST || undefined,
    port,
    secure,
    user: env.SMTP_USER || undefined,
    pass: env.SMTP_PASS || undefined,
    from: env.SMTP_FROM || undefined,
    fromName: env.SMTP_FROM_NAME || 'Akansha',
    replyTo: env.SMTP_REPLY_TO || undefined,
  };
}

export function isSmtpConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const c = smtpConfig(env);
  return !!(c.host && c.user && c.from);
}

export interface SendResult { ok: boolean; status: 'SENT' | 'NOT_CONFIGURED' | 'TRANSPORT_UNAVAILABLE' | 'FAILED'; messageId?: string; errorCode?: string; }

export interface MailMessage { to: string; subject: string; text: string; html?: string; }

// Minimal structural type so tests can inject a fake transport without nodemailer.
export interface TransportLike {
  verify(): Promise<unknown>;
  sendMail(opts: Record<string, unknown>): Promise<{ messageId?: string }>;
}

let cachedTransport: TransportLike | null | undefined;

/** Lazily create the single nodemailer transporter (or null if unavailable). */
export function getTransport(env: NodeJS.ProcessEnv = process.env): TransportLike | null {
  if (cachedTransport !== undefined) return cachedTransport;
  if (!isSmtpConfigured(env)) { cachedTransport = null; return null; }
  try {
    const nodemailer = require('nodemailer');
    const c = smtpConfig(env);
    cachedTransport = nodemailer.createTransport({
      host: c.host,
      port: c.port,
      secure: c.secure,
      requireTLS: !c.secure, // 587 STARTTLS must upgrade; never disable verification
      auth: { user: c.user, pass: c.pass },
    });
  } catch {
    cachedTransport = null;
  }
  // cachedTransport is TransportLike | null here, but the module-scoped `let` is
  // typed `... | undefined`, so normalize defensively for the declared return type.
  return cachedTransport ?? null;
}

/** Strip anything that looks like a credential from an error before surfacing it. */
function redact(msg: string): string {
  return String(msg || 'send failed').replace(/(pass|password|auth|token|secret)[^\s,;]*/gi, '$1=[redacted]').slice(0, 200);
}

export async function sendMail(
  message: MailMessage,
  opts: { env?: NodeJS.ProcessEnv; transport?: TransportLike | null } = {}
): Promise<SendResult> {
  const env = opts.env ?? process.env;
  if (!isSmtpConfigured(env)) return { ok: false, status: 'NOT_CONFIGURED' };
  const transport = opts.transport !== undefined ? opts.transport : getTransport(env);
  if (!transport) return { ok: false, status: 'TRANSPORT_UNAVAILABLE' };
  const c = smtpConfig(env);
  try {
    const info = await transport.sendMail({
      from: c.fromName ? `"${c.fromName}" <${c.from}>` : c.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      replyTo: c.replyTo || undefined,
    });
    return { ok: true, status: 'SENT', messageId: info?.messageId };
  } catch (e: any) {
    return { ok: false, status: 'FAILED', errorCode: redact(e?.message || String(e)) };
  }
}

// ── Typed transactional helpers (single transporter, no scattered clients) ──
export const sendWelcomeEmail = (to: string, name?: string) =>
  sendMail({ to, subject: 'Welcome to Akansha', text: `Welcome${name ? `, ${name}` : ''}! Your Akansha account is ready.` });

export const sendLoginNotification = (to: string, detail = '') =>
  sendMail({ to, subject: 'New Akansha sign-in', text: `A new sign-in to your Akansha account${detail ? `: ${detail}` : ''}. If this wasn't you, review your account.` });

export const sendSecurityNotification = (to: string, text: string) =>
  sendMail({ to, subject: 'Akansha security notice', text });

export const sendSystemNotification = (to: string, subject: string, text: string) =>
  sendMail({ to, subject, text });

/** Reset the cached transport (tests / env reload). */
export function resetTransportCache() { cachedTransport = undefined; }
