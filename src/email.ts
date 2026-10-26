import path from 'node:path';
import nodemailer from 'nodemailer';
import { config } from './config';

function createTransport() {
  const { host, port, secure, user, pass } = config.email;
  if (!host || !user || !pass) {
    throw new Error(
      'Email not configured. Set SMTP_HOST, SMTP_USER and SMTP_PASS (see .env.example).'
    );
  }
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
}

function recipients(to: string[]): string {
  if (to.length === 0) {
    throw new Error('No email recipients configured. Set EMAIL_TO (comma-separated).');
  }
  return to.join(', ');
}

function normalizeAddress(value: unknown): string {
  if (typeof value === 'string') return value.trim().toLowerCase();
  if (value && typeof value === 'object' && 'address' in value) {
    return String((value as { address: unknown }).address).trim().toLowerCase();
  }
  return String(value).trim().toLowerCase();
}

function assertAllRecipientsAccepted(
  info: { accepted?: unknown; rejected?: unknown },
  to: string[]
): void {
  if (!Array.isArray(info.accepted) && !Array.isArray(info.rejected)) return;

  const accepted = new Set(
    (Array.isArray(info.accepted) ? info.accepted : []).map(normalizeAddress)
  );
  const rejected = (Array.isArray(info.rejected) ? info.rejected : []).map(
    normalizeAddress
  );
  const missing = to.map(normalizeAddress).filter((address) => !accepted.has(address));

  if (missing.length > 0) {
    const details = rejected.length > 0 ? ` Rejected: ${rejected.join(', ')}.` : '';
    throw new Error(`Email was not accepted for: ${missing.join(', ')}.${details}`);
  }
}

/**
 * Send one or more PDF files as attachments in a single email.
 */
export async function sendFilesByEmail(
  filePaths: string[],
  subject: string,
  body: string,
  to: string[] = config.email.to
): Promise<void> {
  if (filePaths.length === 0) {
    throw new Error('No attachments to send.');
  }

  const transporter = createTransport();
  const info = await transporter.sendMail({
    from: config.email.from ?? config.email.user,
    to: recipients(to),
    subject,
    text: body,
    attachments: filePaths.map((filePath) => ({
      filename: path.basename(filePath),
      path: filePath,
      contentType: 'application/pdf',
    })),
  });
  assertAllRecipientsAccepted(info, to);
}

/**
 * Send a generated invoice PDF as an email attachment.
 */
export async function sendInvoiceByEmail(
  filePath: string,
  subject: string,
  body: string
): Promise<void> {
  return sendFilesByEmail([filePath], subject, body);
}

/**
 * Send a simple message to check the SMTP configuration.
 */
export async function sendTestEmail(): Promise<void> {
  const transporter = createTransport();
  await transporter.sendMail({
    from: config.email.from ?? config.email.user,
    to: recipients(config.email.to),
    subject: 'Teste - Bot de faturas Mercado Livre',
    text:
      'Teste de envio de email do bot de faturas. ' +
      'Se você recebeu esta mensagem, a configuração SMTP está funcionando.',
  });
}
