import pg from 'pg'
import { env } from '../../config/env.js'

const { Pool } = pg

let readonlyPool: pg.Pool | null = null

function getPool(): pg.Pool {
  if (readonlyPool) return readonlyPool

  const baseUrl = env.DATABASE_URL
  const user = env.BUNNY_BOT_DB_USER
  const password = env.BUNNY_BOT_SECRET

  if (!baseUrl) {
    throw new Error('DATABASE_URL is not set — needed to derive the bunny readonly connection')
  }
  if (!user || !password) {
    throw new Error('BUNNY_BOT_DB_USER and BUNNY_BOT_SECRET must be set')
  }

  const url = new URL(baseUrl)
  url.username = encodeURIComponent(user)
  url.password = encodeURIComponent(password)

  readonlyPool = new Pool({
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  })

  readonlyPool.on('error', (err) => {
    console.error('[bunny-pg] idle client error:', err.message)
  })

  return readonlyPool
}

export type QueryRow = Record<string, unknown>

export async function executeQuery(sql: string): Promise<QueryRow[]> {
  if (typeof sql !== 'string' || !sql.trim()) {
    throw new Error('executeQuery: SQL must be a non-empty string')
  }

  const client = await getPool().connect()
  try {
    await client.query('BEGIN READ ONLY')
    await client.query("SET LOCAL statement_timeout = '10s'")
    const result = await client.query(sql)
    await client.query('COMMIT')
    return result.rows as QueryRow[]
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // already rolled back
    }
    throw err
  } finally {
    client.release()
  }
}
