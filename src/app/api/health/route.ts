import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * Liveness probe. The SERVER being up is reported with HTTP 200; the database
 * is a sub-component reported honestly in the body. A missing DATABASE_URL is a
 * normal, supported state (Akansha runs without persistence), so it must NOT
 * surface as a 500 — otherwise readiness gates (e.g. the Electron shell) would
 * never consider the backend available.
 */
export async function GET() {
  let database: "up" | "unavailable" = "up";
  let databaseReason = "";
  try {
    await db.execute(sql`select 1`);
  } catch (e: any) {
    database = "unavailable";
    const inner = e?.cause || e;
    databaseReason = String(`${inner?.code || ""} ${inner?.message || e?.message || e}`)
      .replace(/(postgres(?:ql)?:\/\/)[^\s@]*@/gi, "$1***@")
      .slice(0, 220);
  }
  return Response.json({
    ok: true,
    server: "up",
    database,
    persistence: database === "up" ? "enabled" : "disabled",
    dbConfigured: !!process.env.DATABASE_URL,
    dbSsl: /sslmode=require/i.test(process.env.DATABASE_URL || ""),
    ...(databaseReason ? { databaseReason } : {}),
  });
}
