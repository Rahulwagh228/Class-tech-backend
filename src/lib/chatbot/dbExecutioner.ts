import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let readonlyClient: SupabaseClient | null = null

function getClient(): SupabaseClient {
  if (!readonlyClient) {
    const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.BUNNY_BOT_SECRET
    if (!url || !key) {
      throw new Error('SUPABASE_URL and BUNNY_BOT_SECRET must be set')
    }
    readonlyClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return readonlyClient
}

export type QueryRow = Record<string, unknown>

export async function executeQuery(sql: string): Promise<QueryRow[]> {
  if (typeof sql !== 'string' || !sql.trim()) {
    throw new Error('executeQuery: SQL must be a non-empty string')
  }

  const { data, error } = await getClient().rpc('run_readonly_query', {
    query_text: sql,
  })

  if (error) {
    throw new Error(`DB Error: ${error.message}`)
  }

  if (data == null) return []
  return Array.isArray(data) ? (data as QueryRow[]) : [data as QueryRow]
}
