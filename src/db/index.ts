import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const databaseCa = process.env.DATABASE_SSL_CA;
const connectionUrl = new URL(databaseUrl);
// pg parses URL SSL options after Pool options; remove them when supplying an explicit CA.
if (databaseCa) for (const key of ["sslmode", "sslrootcert", "sslcert", "sslkey"]) connectionUrl.searchParams.delete(key);

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString: connectionUrl.toString(),
    ...(databaseCa ? { ssl: { ca: databaseCa, rejectUnauthorized: true } } : {}),
    max: 5,
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 10_000,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool);
