import { Parser } from 'node-sql-parser'

const parser = new Parser()
const PG_OPTS = { database: 'PostgreSQL' as const }

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

export type ValidateResult = { valid: true } | { valid: false; reason: string }

export function validateSQL(sql: string, tutionId: string): ValidateResult {
  if (typeof sql !== 'string' || !sql.trim()) {
    return { valid: false, reason: 'Empty SQL' }
  }

  const trimmed = sql.trim().replace(/;\s*$/, '')
  const stripped = stripStringsAndComments(trimmed)

  if (stripped.includes(';')) {
    return { valid: false, reason: 'Multiple statements are not allowed' }
  }

  const upper = stripped.toUpperCase().trimStart()
  if (!upper.startsWith('SELECT') && !upper.startsWith('WITH')) {
    return { valid: false, reason: 'Only SELECT / WITH queries are allowed' }
  }

  const tokens = new Set(upper.split(/[^A-Z_]+/).filter(Boolean))
  for (const kw of FORBIDDEN_KEYWORDS) {
    if (tokens.has(kw)) {
      return { valid: false, reason: `Dangerous keyword: ${kw}` }
    }
  }

  if (/\bINTO\s+\w/i.test(stripped)) {
    return { valid: false, reason: 'SELECT INTO is not allowed' }
  }
  if (/\bFOR\s+UPDATE\b/i.test(stripped) || /\bFOR\s+SHARE\b/i.test(stripped)) {
    return { valid: false, reason: 'Row locking clauses are not allowed' }
  }

  if (!stripped.toLowerCase().includes('tution_id') || !trimmed.includes(tutionId)) {
    return { valid: false, reason: 'Query must be scoped to the current tution_id' }
  }

  try {
    const ast = parser.astify(trimmed, PG_OPTS)
    const statements = Array.isArray(ast) ? ast : [ast]
    if (statements.length !== 1) {
      return { valid: false, reason: 'Multiple statements are not allowed' }
    }
    const type = (statements[0] as { type?: string }).type
    if (type !== 'select' && type !== 'with') {
      return { valid: false, reason: `Disallowed statement type: ${type}` }
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { valid: false, reason: `SQL parse error: ${message}` }
  }

  return { valid: true }
}

function stripStringsAndComments(sql: string): string {
  let out = sql
  out = out.replace(/--[^\n]*/g, ' ')
  out = out.replace(/\/\*[\s\S]*?\*\//g, ' ')
  out = out.replace(/'(?:''|[^'])*'/g, "''")
  out = out.replace(/"(?:""|[^"])*"/g, '""')
  return out
}
