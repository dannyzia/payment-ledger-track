import pg from 'pg';
import { env } from '$env/dynamic/private';

// Configure PostgreSQL DATE type parser (OID 1082) to return string 'YYYY-MM-DD'
// preventing automatic UTC Date conversion that corrupts Dexie entry_date string indexes
pg.types.setTypeParser(1082, (val: string) => val);

let pool: pg.Pool | null = null;

/**
 * Normalizes connection string and SSL options for pg.Pool.
 * Strips `sslmode` query parameter so `pg-connection-string` does not override
 * `ssl.rejectUnauthorized: false` on managed cloud poolers (e.g. Supabase).
 */
export function parsePoolConfig(rawConnectionString: string): {
  connectionString: string;
  ssl?: { rejectUnauthorized: boolean };
} {
  try {
    const u = new URL(rawConnectionString);
    const isLocal = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    const sslParam = u.searchParams.get('sslmode');
    u.searchParams.delete('sslmode');
    const useSsl = sslParam ? sslParam !== 'disable' : !isLocal;
    return {
      connectionString: u.toString(),
      ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    };
  } catch {
    return { connectionString: rawConnectionString, ssl: undefined };
  }
}

/**
 * Singleton PostgreSQL connection pool client for server queries.
 * Utilizes DATABASE_URL from private environment.
 */
export function getDbPool(): pg.Pool {
  if (!pool) {
    const rawConnectionString = env.DATABASE_URL || process.env.DATABASE_URL;
    if (!rawConnectionString) {
      throw new Error('DATABASE_URL environment variable is not configured');
    }
    const { connectionString, ssl } = parsePoolConfig(rawConnectionString);
    pool = new pg.Pool({
      connectionString,
      ssl,
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
