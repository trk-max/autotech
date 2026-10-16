import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';

export const ROOT = path.resolve(__dirname, '../../..');
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/autotech',
  port: Number(process.env.API_PORT ?? process.env.PORT ?? 4000),
  storageDir: path.resolve(ROOT, process.env.STORAGE_DIR ?? './storage'),
  fontsDir: path.resolve(__dirname, '../assets/fonts'),
  // Single-workshop demo identity until authentication is added (TRD §1, Supabase Auth)
  demoOrgId: process.env.DEMO_ORG_ID ?? '00000000-0000-4000-8000-000000000001',
  demoUserId: process.env.DEMO_USER_ID ?? '00000000-0000-4000-8000-000000000002',
};
fs.mkdirSync(config.storageDir, { recursive: true });
