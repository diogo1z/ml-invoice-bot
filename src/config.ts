import * as dotenv from 'dotenv';
import path from 'node:path';

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}. See .env.example`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  meli: {
    accessToken: process.env.MELI_ACCESS_TOKEN as string | undefined,
    appId: process.env.MELI_APP_ID as string | undefined,
    appSecret: process.env.MELI_APP_SECRET as string | undefined,
    refreshToken: process.env.MELI_REFRESH_TOKEN as string | undefined,
  },
  meliRequired: (): string => required('MELI_ACCESS_TOKEN'),
  ordersDays: parseInt(optional('ORDERS_DAYS', '7'), 10),
  statuses: optional('ORDER_STATUSES', 'paid').split(',').map((s) => s.trim()),
  outputDir: optional('OUTPUT_DIR', path.resolve(__dirname, '..', 'invoices')),

  whatsapp: {
    // Group id as "XXXXXXXXX@c.us" or find by name.
    groupId: process.env.WHATSAPP_GROUP_ID as string | undefined,
    groupName: process.env.WHATSAPP_GROUP_NAME as string | undefined,
    useWeb: optional('WHATSAPP_MODE', 'web') !== 'click-to-chat',
    sessionDir: optional('WHATSAPP_SESSION_DIR', path.resolve(__dirname, '..', '.wwebjs_auth')),
  },

  // Click-to-chat fallback numbers to notify (international format, e.g. 15551234567)
  fallbackNumbers: (process.env.FALLBACK_NUMBERS ?? '')
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean),

  timezone: optional('TIMEZONE', 'America/Sao_Paulo'),
};
