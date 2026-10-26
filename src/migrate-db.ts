import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { config } from './config';
import { SCHEMA_SQL } from './db';

async function main(): Promise<void> {
  const url = process.env.DB_URL;
  const authToken = process.env.DB_AUTH_TOKEN;
  const needsAuth = !!url && !url.startsWith('file:');
  if (!url) throw new Error('Set DB_URL to the Turso/libSQL database URL.');
  if (needsAuth && !authToken) {
    throw new Error('Set DB_AUTH_TOKEN to the Turso auth token.');
  }

  const localPath = path.resolve(config.dbPath);
  if (!fs.existsSync(localPath)) {
    console.log(`No local database found at ${localPath}; nothing to migrate.`);
    return;
  }

  const local = createClient({ url: `file:${localPath}` });
  const remote = createClient({ url, authToken: needsAuth ? authToken : undefined });

  try {
    const result = await local
      .execute('SELECT shipment_id, order_id, label_file, sent_at, email_to FROM sent_labels')
      .catch((err) => {
        if (err instanceof Error && /no such table/i.test(err.message)) return null;
        throw err;
      });

    if (!result) {
      console.log('Local database has no sent_labels table; nothing to migrate.');
      return;
    }

    const rows = result.rows;
    if (rows.length === 0) {
      console.log('No local rows to migrate.');
      return;
    }

    await remote.executeMultiple(SCHEMA_SQL);
    await remote.batch(
      rows.map((row) => ({
        sql:
          'INSERT OR IGNORE INTO sent_labels ' +
          '(shipment_id, order_id, label_file, sent_at, email_to) VALUES (?, ?, ?, ?, ?)',
        args: [
          Number(row.shipment_id),
          String(row.order_id),
          String(row.label_file),
          String(row.sent_at),
          String(row.email_to),
        ],
      })),
      'write'
    );

    const remoteCount = await remote.execute('SELECT COUNT(*) AS count FROM sent_labels');
    console.log(
      `Migrated ${rows.length} local row(s). Remote total: ` +
        `${Number(remoteCount.rows[0]?.count ?? 0)}.`
    );
  } finally {
    local.close();
    remote.close();
  }
}

main().catch((err) => {
  console.error('Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
