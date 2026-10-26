import { createClient, type Client } from '@libsql/client';
import { config } from './config';

let client: Client | undefined;
let schemaReady: Promise<void> | undefined;

export const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS sent_labels (
    shipment_id INTEGER PRIMARY KEY,
    order_id TEXT NOT NULL,
    label_file TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    email_to TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sent_labels_order ON sent_labels(order_id);
`;

export interface SentLabel {
  shipmentId: number;
  orderId: string;
  labelFile: string;
  emailTo: string;
}

function db(): Client {
  if (!client) {
    client = createClient({
      url: config.dbUrl,
      authToken: config.dbAuthToken,
    });
  }
  return client;
}

function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = db()
      .executeMultiple(SCHEMA_SQL)
      .catch((err) => {
        schemaReady = undefined;
        throw err;
      });
  }
  return schemaReady;
}

export async function isLabelSent(shipmentId: number): Promise<boolean> {
  await ensureSchema();
  const result = await db().execute({
    sql: 'SELECT 1 FROM sent_labels WHERE shipment_id = ?',
    args: [shipmentId],
  });
  return result.rows.length > 0;
}

export async function markLabelsSent(labels: SentLabel[]): Promise<void> {
  if (labels.length === 0) return;
  await ensureSchema();

  const sentAt = new Date().toISOString();
  await db().batch(
    labels.map((label) => ({
      sql:
        'INSERT OR IGNORE INTO sent_labels ' +
        '(shipment_id, order_id, label_file, sent_at, email_to) VALUES (?, ?, ?, ?, ?)',
      args: [label.shipmentId, label.orderId, label.labelFile, sentAt, label.emailTo],
    })),
    'write'
  );
}
