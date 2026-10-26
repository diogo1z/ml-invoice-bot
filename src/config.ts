import * as dotenv from 'dotenv';
import path from 'node:path';

dotenv.config();

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function list(name: string, fallback = ''): string[] {
  return (process.env[name] || fallback)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

const localDbPath =
  process.env.DB_PATH || path.resolve(__dirname, '..', 'data', 'labels.db');
const dbUrl = process.env.DB_URL || `file:${path.resolve(localDbPath)}`;
const dbAuthToken = dbUrl.startsWith('file:')
  ? undefined
  : process.env.DB_AUTH_TOKEN || undefined;

type DeliveryMode = 'whatsapp' | 'email' | 'both';

function deliveryMode(): DeliveryMode {
  const value = optional('DELIVERY_MODE', 'whatsapp').toLowerCase();
  if (value === 'whatsapp' || value === 'email' || value === 'both') return value;
  throw new Error(`Invalid DELIVERY_MODE "${value}". Use whatsapp, email or both.`);
}

export const config = {
  meli: {
    accessToken: process.env.MELI_ACCESS_TOKEN as string | undefined,
    appId: process.env.MELI_APP_ID as string | undefined,
    appSecret: process.env.MELI_APP_SECRET as string | undefined,
    refreshToken: process.env.MELI_REFRESH_TOKEN as string | undefined,
  },
  ordersDays: parseInt(optional('ORDERS_DAYS', '7'), 10),
  statuses: optional('ORDER_STATUSES', 'paid').split(',').map((s) => s.trim()),
  outputDir: optional('OUTPUT_DIR', path.resolve(__dirname, '..', 'invoices')),

  // How many paid orders to scan when looking for shipments still to send.
  labelsMaxOrders: parseInt(optional('LABELS_MAX_ORDERS', '300'), 10),

  // SQLite database used to remember which labels were already emailed.
  // DB_URL points to Turso/libSQL in production; locally it falls back to a file.
  dbPath: localDbPath,
  dbUrl,
  dbAuthToken,

  // Where invoices are delivered: whatsapp, email or both.
  deliveryMode: deliveryMode(),

  email: {
    host: process.env.SMTP_HOST,
    port: parseInt(optional('SMTP_PORT', '587'), 10),
    secure: optional('SMTP_SECURE', 'false').toLowerCase() === 'true',
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.EMAIL_FROM,
    to: list('EMAIL_TO'),
    labelsTo: list('LABELS_EMAIL_TO'),
  },

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
