import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, types, type QueryResultRow } from 'pg';
import { config } from '../config';

// bigint ids and numeric values as JS numbers (ids stay far below 2^53)
types.setTypeParser(20, v => Number(v));
types.setTypeParser(1700, v => parseFloat(v));

@Injectable()
export class DbService implements OnModuleDestroy {
  readonly pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

  async query<T extends QueryResultRow = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.pool.query<T>(sql, params)).rows;
  }

  async one<T extends QueryResultRow = any>(sql: string, params: unknown[] = []): Promise<T | null> {
    return (await this.pool.query<T>(sql, params)).rows[0] ?? null;
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}

/** SQL fragment: row's applicability group contains variant $n. */
export const applies = (alias: string, param = '$1') =>
  `EXISTS (SELECT 1 FROM applicability_member am WHERE am.group_id = ${alias}.applicability_group_id AND am.variant_id = ${param})`;
