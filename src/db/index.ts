import type { NodePgDatabase } from "drizzle-orm/node-postgres";

/**
 * Akansha boots and serves the assistant WITHOUT a database.
 *
 * `pg` is a native-ish driver that Next's Turbopack externalizes; loading it
 * eagerly breaks once the app is relocated into a packaged (Electron) tree.
 * So we require `pg` / `drizzle-orm/node-postgres` LAZILY, only when a
 * DATABASE_URL is actually configured. With no DATABASE_URL, `db` is a
 * throwing proxy that the (already try/catch-wrapped) call sites degrade from,
 * and `pg` is never imported at all.
 */
export const isDbConfigured = !!process.env.DATABASE_URL;

type Db = NodePgDatabase<any>;

const globalForDb = globalThis as typeof globalThis & {
  __akanshaDb?: Db;
};

let _db: Db | null = globalForDb.__akanshaDb ?? null;

function createRealDb(): Db {
  // Lazy requires — only executed when a database is configured.
  const { Pool } = require("pg");
  const { drizzle } = require("drizzle-orm/node-postgres");
  let url = process.env.DATABASE_URL || "";
  const managed = /sslmode=require/i.test(url) || /(supabase|pooler\.supabase|neon\.tech|render\.com|railway)/i.test(url);
  let ssl: unknown;
  if (managed) {
    // sslmode=require in the string forces strict verify (fails on Supabase's self-signed
    // intermediate). Strip it so our ssl config wins; traffic stays encrypted, and strict
    // CA pinning is opt-in via AKANSHA_DB_SSL_VERIFY=1.
    url = url.replace(/([?&])sslmode=require/i, (_m, p1) => (p1 === "?" ? "?" : "")).replace(/[?&]$/, "");
    ssl = { require: true, rejectUnauthorized: process.env.AKANSHA_DB_SSL_VERIFY === "1" };
  }
  const pool = new Pool({ connectionString: url, ssl });
  return drizzle(pool);
}

function makeUnavailableDb(): Db {
  const fail = () => {
    throw new Error(
      "DATABASE_URL is not set — persistence is disabled. Configure DATABASE_URL and run `npm run db:migrate` to enable storage."
    );
  };
  return new Proxy({} as Db, { get: () => fail, apply: () => fail });
}

/** Lazily-resolved drizzle client (or a throwing proxy when unconfigured). */
export const db = new Proxy({} as Db, {
  get(_t, prop) {
    if (!_db) {
      _db = isDbConfigured ? createRealDb() : makeUnavailableDb();
      if (isDbConfigured) globalForDb.__akanshaDb = _db;
    }
    const value = (_db as any)[prop];
    return typeof value === "function" ? value.bind(_db) : value;
  },
});
