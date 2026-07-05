import { Groq } from 'groq-sdk'
import { buildSchemaPrompt, type ChatbotRole } from './schemaContext.js'

const QUERY_MODEL = 'llama-3.3-70b-versatile'

let groqClient: Groq | null = null
function getGroq(): Groq {
  if (!groqClient) {
    groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY! })
  }
  return groqClient
}

export interface GenerateQueryArgs {
  message: string
  role: ChatbotRole
  tutionId: string
  userId: string
}

export type GenerateQueryResult =
  | { ok: true; sql: string }
  | { ok: false; error: string; raw?: string }

const FORBIDDEN_KEYWORDS = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'DROP',
  'ALTER',
  'TRUNCATE',
  'GRANT',
  'REVOKE',
  'CREATE',
  'REPLACE',
  'MERGE',
  'CALL',
  'EXECUTE',
  'COPY',
  'VACUUM',
  'ANALYZE',
  'COMMENT',
  'LOCK',
  'BEGIN',
  'COMMIT',
  'ROLLBACK',
  'SAVEPOINT',
  'SET',
  'RESET',
  'LISTEN',
  'NOTIFY',
  'DO',
]

const REFUSAL_SQL = 'SELECT NULL WHERE FALSE'

export async function generateQuery({
  message,
  role,
  tutionId,
  userId,
}: GenerateQueryArgs): Promise<GenerateQueryResult> {
  const trimmed = message.trim()
  if (!trimmed) {
    return { ok: false, error: 'empty message' }
  }

  const systemPrompt = buildSchemaPrompt({ role, tutionId, userId })

  const completion = await getGroq().chat.completions.create({
    model: QUERY_MODEL,
    temperature: 0,
    max_tokens: 600,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: trimmed },
    ],
  })

  const raw = completion.choices[0]?.message?.content ?? ''
  const cleaned = sanitize(raw)

  if (!cleaned) {
    return { ok: false, error: 'model returned empty SQL', raw }
  }

  if (cleaned.toUpperCase().startsWith(REFUSAL_SQL.toUpperCase())) {
    return { ok: false, error: 'request is outside the user’s scope', raw: cleaned }
  }

  const validation = validateSelectOnly(cleaned)
  if (!validation.ok) {
    return { ok: false, error: validation.error, raw: cleaned }
  }

  return { ok: true, sql: cleaned }
}

function sanitize(raw: string): string {
  let s = raw.trim()

  s = s.replace(/^```(?:sql|postgres|postgresql)?\s*/i, '').replace(/```\s*$/i, '')

  s = s.replace(/^\s*sql\s*[:\-]\s*/i, '')

  s = s.replace(/;\s*$/, '').trim()

  return s
}

interface ValidationResult {
  ok: boolean
  error: string
}

function validateSelectOnly(sql: string): ValidationResult {
  if (!sql) return { ok: false, error: 'empty SQL' }

  const stripped = stripStringsAndComments(sql)

  if (stripped.includes(';')) {
    return { ok: false, error: 'multiple statements are not allowed' }
  }

  const upper = stripped.toUpperCase().trimStart()
  if (!upper.startsWith('SELECT') && !upper.startsWith('WITH')) {
    return { ok: false, error: 'only SELECT / WITH queries are allowed' }
  }

  const tokens = upper.split(/[^A-Z_]+/).filter(Boolean)
  const tokenSet = new Set(tokens)
  for (const kw of FORBIDDEN_KEYWORDS) {
    if (tokenSet.has(kw)) {
      return { ok: false, error: `forbidden keyword detected: ${kw}` }
    }
  }

  if (/\bINTO\s+\w/i.test(stripped)) {
    return { ok: false, error: 'SELECT INTO is not allowed' }
  }

  if (/\bFOR\s+UPDATE\b/i.test(stripped) || /\bFOR\s+SHARE\b/i.test(stripped)) {
    return { ok: false, error: 'row locking clauses are not allowed' }
  }

  return { ok: true, error: '' }
}

function stripStringsAndComments(sql: string): string {
  let out = sql

  out = out.replace(/--[^\n]*/g, ' ')
  out = out.replace(/\/\*[\s\S]*?\*\//g, ' ')

  out = out.replace(/'(?:''|[^'])*'/g, "''")
  out = out.replace(/"(?:""|[^"])*"/g, '""')

  return out
}
