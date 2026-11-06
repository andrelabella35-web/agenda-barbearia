import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../db.js';

export async function migrate(): Promise<string[]> {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../db/migrations');
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())');
  const done = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const applied: string[] = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(fs.readFileSync(path.join(dir, file), 'utf8'));
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      applied.push(file);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
  return applied;
}

if (process.argv[1]?.endsWith('migrate.ts')) {
  migrate().then((a) => { console.log('Migrations aplicadas:', a.length ? a.join(', ') : 'nenhuma'); return pool.end(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
