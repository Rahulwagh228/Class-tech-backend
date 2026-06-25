import { Groq } from 'groq-sdk'

const INTENT_MODEL = 'llama3-8b-8192'

let groqClient: Groq | null = null
function getGroq(): Groq {
  if (!groqClient) {
    groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY! })
  }
  return groqClient
}

export type Intent = 'sql_query' | 'small_talk' | 'help' | 'unsupported'

export interface IntentResult {
  intent: Intent
  needsSql: boolean
  confidence: number
  reason: string
}

const SYSTEM_PROMPT = `You are an intent classifier for a coaching-institute chatbot called Classly.
Classify the user's message into EXACTLY ONE of these intents:

1. "sql_query"   - The user wants data from the database (attendance, students, teachers, batches, results, counts, lists, reports, "show me", "how many", "list", "who", "when", "what is the status of...").
2. "small_talk"  - Greetings, thanks, casual conversation, identity questions ("hi", "thank you", "who are you", "good morning").
3. "help"        - The user is asking HOW to use the platform or what the chatbot can do ("what can you do", "how do I mark attendance", "how does this work").
4. "unsupported" - Mutation requests (insert/update/delete/create), off-topic questions, or anything outside Classly's domain (weather, news, math, jokes, code, other companies).

Rules:
- Only "sql_query" should trigger a database call. Everything else must NOT trigger SQL.
- Mutation-style requests ("mark John absent", "add a new student", "delete batch X") are ALWAYS "unsupported" — the chatbot is read-only.
- Ambiguous data questions lean toward "sql_query".
- Pure greetings with a follow-up data question ("hi, can you show me today's attendance") are "sql_query".

Respond with ONLY a JSON object — no markdown, no prose:
{"intent":"sql_query|small_talk|help|unsupported","confidence":0.0-1.0,"reason":"<short reason under 15 words>"}`

export async function classifyIntent(message: string): Promise<IntentResult> {
  const trimmed = message.trim()

  if (!trimmed) {
    return {
      intent: 'small_talk',
      needsSql: false,
      confidence: 1,
      reason: 'empty message',
    }
  }

  const completion = await getGroq().chat.completions.create({
    model: INTENT_MODEL,
    temperature: 0,
    max_tokens: 120,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: trimmed },
    ],
  })

  const raw = completion.choices[0]?.message?.content ?? ''
  return parseIntent(raw)
}

function parseIntent(raw: string): IntentResult {
  let parsed: { intent?: string; confidence?: number; reason?: string }
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {
      intent: 'unsupported',
      needsSql: false,
      confidence: 0,
      reason: 'classifier returned invalid JSON',
    }
  }

  const intent = normalizeIntent(parsed.intent)
  const confidence =
    typeof parsed.confidence === 'number' && parsed.confidence >= 0 && parsed.confidence <= 1
      ? parsed.confidence
      : 0.5

  return {
    intent,
    needsSql: intent === 'sql_query',
    confidence,
    reason: (parsed.reason ?? '').toString().slice(0, 200),
  }
}

function normalizeIntent(value: unknown): Intent {
  const allowed: Intent[] = ['sql_query', 'small_talk', 'help', 'unsupported']
  if (typeof value === 'string' && (allowed as string[]).includes(value)) {
    return value as Intent
  }
  return 'unsupported'
}
