/**
 * Email transport — the REAL send path for the communication capability.
 *
 * Wires Akansha's authoritative mailService (nodemailer/SMTP) into the
 * communication layer so a "send file/report to <recipient> by email" actually
 * sends and is VERIFIED by a real messageId. If SMTP is not configured, the
 * platform is reported as NOT configured and the send honestly returns
 * CAPABILITY_UNAVAILABLE — never a fake "sent".
 */
import { sendMail, isSmtpConfigured, type MailMessage } from '../email/mailService';
import type { Platform, Contact } from './communicationCapability';

export function emailPlatform(): Platform {
  // 'configured' reflects the ACTUAL env, not a wish — so availability is honest.
  return { id: 'email', label: 'Email (SMTP)', configured: isSmtpConfigured(), requiresAuth: false };
}

/** Build the mail body for an artifact (file path or text) + optional message. */
export function mailForArtifact(to: string, artifact: string, note?: string): MailMessage {
  return {
    to,
    subject: note ? note : `Akansha: ${artifact}`,
    text: `Sent by Akansha.\n\nItem: ${artifact}${note ? `\nNote: ${note}` : ''}`,
  };
}

/**
 * Real send via SMTP. Returns a provider confirmation (messageId) on success or
 * null on any failure — the caller (sendFile) treats null as NOT sent.
 */
export async function emailTransport(_p: Platform, to: Contact, artifact: string, note?: string): Promise<string | null> {
  if (!isSmtpConfigured()) return null; // honest: no SMTP -> not sent
  const res = await sendMail(mailForArtifact(to.identifier, artifact, note));
  return res.ok ? (res.messageId || 'sent') : null;
}
