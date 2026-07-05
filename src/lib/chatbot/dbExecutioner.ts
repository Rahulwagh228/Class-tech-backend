import pg from "pg";
import { env } from "../../config/env.js";

const { Pool } = pg;

let readonlyPool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (readonlyPool) return readonlyPool;

  const baseUrl = env.DATABASE_URL;
  const user = env.BUNNY_BOT_DB_USER;
  const password = env.BUNNY_BOT_SECRET;
  console.log("bunny bot password = ", password);

  if (!baseUrl) {
    throw new Error(
      "DATABASE_URL is not set — needed to derive the bunny readonly connection",
    );
  }
  if (!user || !password) {
    throw new Error("BUNNY_BOT_DB_USER and BUNNY_BOT_SECRET must be set");
  }

  const url = new URL(baseUrl);
  url.username = user;
  url.password = password;

  readonlyPool = new Pool({
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    keepAlive: true,
  });

  readonlyPool.on("error", (err) => {
    console.error("[bunny-pg] idle client error:", err.message);
  });

  return readonlyPool;
}

export type QueryRow = Record<string, unknown>;

export async function executeQuery(sql: string): Promise<QueryRow[]> {
  if (typeof sql !== "string" || !sql.trim()) {
    throw new Error("executeQuery: SQL must be a non-empty string");
  }

  const client = await getPool().connect();
  const onClientError = (err: Error) => {
    console.error("[bunny-pg] checked-out client error:", err.message);
  };
  client.on("error", onClientError);
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '10s'");
    console.log("[bunny]: step 5: executing SQL:\n" + sql);
    const result = await client.query(sql);
    console.log(
      "[bunny]: step 5: query executed, rows returned:",
      result.rowCount,
    );
    await client.query("COMMIT");
    return result.rows as QueryRow[];
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // already rolled back
    }
    throw err;
  } finally {
    client.removeListener("error", onClientError);
    client.release();
  }
}
