import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

/**
 * Akansha can boot and serve the assistant WITHOUT a database.
 *
 * Persistence (providers, memory, ledger, traces, credentials) is optional:
 * when DATABASE_URL is absent every db.* call throws a clear, typed error that
 * the (already try/catch-wrapped) call sites degrade gracefully from. The
 * server therefore starts, the health endpoint reports an honest status, and
 * model providers fall back to built-in/env configuration in memory.
 *
 * Set DATABASE_URL and run migrations to enable durable storage.
 */
export const isDbConfigured = !!databaseUrl;

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

let _pool: Pool | null = null;
let _client: ReturnType<typeof drizzle> | null = null;

if (databaseUrl) {
  _pool =
    globalForDb.__arenaNextJsPostgresqlPool ??
    new Pool({ connectionString: databaseUrl });

  if (process.env.NODE_ENV !== "production") {
    globalForDb.__arenaNextJsPostgresqlPool = _pool;
  }

  _client = drizzle(_pool);
}

export const pool = _pool;

function makeUnavailableDb(): ReturnType<typeof drizzle> {
  const fail = () => {
    throw new Error(
      "DATABASE_URL is not set — persistence is disabled. Configure DATABASE_URL and run `npm run db:migrate` to enable storage."
    );
  };
  // Proxy so any `db.<method>(...)` access throws a clear, catchable error
  // instead of crashing the process at import time.
  return new Proxy({} as ReturnType<typeof drizzle>, {
    get: () => fail,
    apply: () => fail,
  });
}

export const db: ReturnType<typeof drizzle> = _client ?? makeUnavailableDb();
