import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';

export const ROOT = path.resolve(__dirname, '../../..');
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

export const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/autotech';
export const STORAGE_DIR = path.resolve(ROOT, process.env.STORAGE_DIR ?? './storage');
fs.mkdirSync(STORAGE_DIR, { recursive: true });
