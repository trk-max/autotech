import { Client } from 'pg';
import { DATABASE_URL } from './env';
import { migrate } from './migrate';
import { seed } from './seed';

(async () => {
  const host = new URL(DATABASE_URL).hostname;
  if (!['localhost', '127.0.0.1', 'db', 'postgres'].includes(host) && process.env.RESET_CONFIRM !== 'yes') {
    throw new Error(`Refusing to wipe non-local database ${host}. Set RESET_CONFIRM=yes to force.`);
  }
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(client);
  await seed(client);
  await client.end();
  console.log('Database reset, migrated and seeded.');
})().catch(e => { console.error(e); process.exit(1); });
