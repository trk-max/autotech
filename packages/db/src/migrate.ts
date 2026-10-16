import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { DATABASE_URL } from './env';

export async function migrate(client: Client): Promise<string[]> {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const dir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  const done = new Set((await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map(r => r.name));
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
      await client.query('COMMIT');
      applied.push(f);
    } catch (e) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${f} failed: ${(e as Error).message}`);
    }
  }
  return applied;
}

if (require.main === module) {
  (async () => {
    const client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    const applied = await migrate(client);
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database already up to date.');
    await client.end();
  })().catch(e => { console.error(e.message); process.exit(1); });
}
