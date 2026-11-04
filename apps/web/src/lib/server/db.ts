import pg from 'pg';
import { env } from '$env/dynamic/private';

// Configure PostgreSQL DATE type parser (OID 1082) to return string 'YYYY-MM-DD'
// preventing automatic UTC Date conversion that corrupts Dexie entry_date string indexes
pg.types.setTypeParser(1082, (val: string) => val);

let pool: pg.Pool | null = null;

/**
 * Singleton PostgreSQL connection pool client for server queries.
 * Utilizes DATABASE_URL from private environment.
 */
export function getDbPool(): pg.Pool {
  if (!pool) {
    const connectionString = env.DATABASE_URL || process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not configured');
    }
    pool = new pg.Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return pool;
}

/**
 * Terminates the pool connection. Used in automated test teardown.
 */
export async function closeDbPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
