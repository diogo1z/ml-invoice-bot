import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';
import { sendLabelsByEmail } from './actions';

const lockFile = path.join(path.dirname(config.dbPath), 'labels.lock');

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireLock(): boolean {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });

  if (fs.existsSync(lockFile)) {
    const pid = Number.parseInt(fs.readFileSync(lockFile, 'utf8'), 10);
    if (Number.isFinite(pid) && pid > 0 && isProcessRunning(pid)) {
      return false;
    }
    fs.rmSync(lockFile, { force: true });
  }

  try {
    fs.writeFileSync(lockFile, String(process.pid), { flag: 'wx' });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw err;
  }
}

async function main(): Promise<void> {
  if (!acquireLock()) {
    console.log('Another labels run is already in progress. Skipping.');
    return;
  }

  try {
    await sendLabelsByEmail();
  } finally {
    fs.rmSync(lockFile, { force: true });
  }
}

main().catch((err) => {
  console.error('Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
