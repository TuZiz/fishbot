// Read-only cloud database compatibility probe. The key file is removed by the caller.
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { snapshotDatabase } from '../dist/adapters/wechat/database/snapshot.js';

const source = process.env.CLOUD_DB_PATH;
const keyFile = process.env.CLOUD_DB_KEY_FILE;
if (!source || !keyFile) throw new Error('CLOUD_DB_PATH and CLOUD_DB_KEY_FILE are required');
const key = (await readFile(keyFile, 'utf8')).trim();
const folder = await mkdtemp(join(tmpdir(), 'fishbot-cloud-probe-'));
const destination = join(folder, 'message_0.sqlite');
const report = { source, readOnly: true, decrypted: false, tables: [], hasName2Id: false, messageTableCount: 0 };
try {
  await snapshotDatabase(source, destination, key);
  const db = new DatabaseSync(destination, { readOnly: true });
  try {
    report.decrypted = true;
    report.tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => row.name).slice(0, 20);
    report.hasName2Id = report.tables.includes('Name2Id');
    report.messageTableCount = report.tables.filter(name => String(name).startsWith('Msg_')).length;
  } finally { db.close(); }
} catch (error) {
  report.error = error instanceof Error ? error.message : 'database probe failed';
} finally {
  await rm(folder, { recursive: true, force: true });
}
console.log(JSON.stringify(report));
if (!report.decrypted) process.exitCode = 1;
