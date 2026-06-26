import type { Request, Response } from 'express'
import { classifyIntent } from '../../lib/chatbot/intentClassifier.js'
import { generateQuery } from '../../lib/chatbot/queryGenerator.js'
import { validateSQL } from '../../lib/chatbot/sqlValidator.js'
import { executeQuery } from '../../lib/chatbot/dbExecutioner.js'
import { generateResponse } from '../../lib/chatbot/responseGenerator.js'
import type { ChatbotRole } from '../../lib/chatbot/schemaContext.js'

const SMALL_TALK_REPLY =
  "Hi! I'm Bunny — Classly's read-only data assistant. Ask me about attendance, students, batches, or teachers and I'll pull the numbers for you."

const HELP_REPLY =
  "I can answer read-only questions about your tution's data — attendance trends, student lists, batch rosters, teacher assignments, and so on. I can't change anything in the system. Try: \"How many students were absent in Batch A this week?\""

const UNSUPPORTED_REPLY =
  "I can only answer read-only questions about your Classly data. I can't make changes, and I don't handle topics outside this platform."

export async function bunnyChatHandler(req: Request, res: Response): Promise<void> {
  const t0 = Date.now()
  console.log('\n[bunny] ───── new chat request ─────')

  try {
    const user = req.user
    if (!user) {
      console.warn('[bunny] 401 no req.user (auth missing)')
      res.status(401).json({ error: 'Authentication required' })
      return
    }
    console.log('[bunny] step 1: auth ok', {
      userId: user.id,
      role: user.role,
      tutionId: user.tution_id,
    })

    const { message } = (req.body ?? {}) as { message?: unknown }
    if (typeof message !== 'string' || !message.trim()) {
      console.warn('[bunny] 400 invalid body', { received: typeof message })
      res.status(400).json({ error: 'Body must include a non-empty "message" string' })
      return
    }
    console.log('[bunny] step 2: message received:', JSON.stringify(message))

    const role = user.role as ChatbotRole
    const tutionId = user.tution_id
    const userId = user.id

    console.log('[bunny] step 3: classifying intent...')
    const intent = await classifyIntent(message)
    console.log('[bunny] step 3: intent =', intent)

    if (intent.intent === 'small_talk') {
      console.log('[bunny] → small_talk, returning canned reply')
      res.status(200).json({ intent: intent.intent, answer: SMALL_TALK_REPLY })
      console.log('[bunny] ───── done in', Date.now() - t0, 'ms ─────')
      return
    }
    if (intent.intent === 'help') {
      console.log('[bunny] → help, returning canned reply')
      res.status(200).json({ intent: intent.intent, answer: HELP_REPLY })
      console.log('[bunny] ───── done in', Date.now() - t0, 'ms ─────')
      return
    }
    if (intent.intent === 'unsupported') {
      console.log('[bunny] → unsupported:', intent.reason)
      res.status(200).json({
        intent: intent.intent,
        answer: UNSUPPORTED_REPLY,
        reason: intent.reason,
      })
      console.log('[bunny] ───── done in', Date.now() - t0, 'ms ─────')
      return
    }

    console.log('[bunny] step 4: generating SQL...')
    const generated = await generateQuery({ message, role, tutionId, userId })
    if (!generated.ok) {
      console.warn('[bunny] step 4: generation failed:', generated.error)
      console.warn('[bunny]   raw:', generated.raw)
      res.status(200).json({
        intent: intent.intent,
        answer:
          "I couldn't translate that into a safe query. Could you rephrase or be more specific?",
        error: generated.error,
      })
      console.log('[bunny] ───── done in', Date.now() - t0, 'ms ─────')
      return
    }
    console.log('[bunny] step 4: SQL generated:\n' + generated.sql)

    console.log('[bunny] step 5: validating SQL...')
    const check = validateSQL(generated.sql, tutionId)
    if (!check.valid) {
      console.warn('[bunny] step 5: validation failed:', check.reason)
      res.status(200).json({
        intent: intent.intent,
        answer: "I couldn't run that safely. Could you rephrase your question?",
        error: check.reason,
      })
      console.log('[bunny] ───── done in', Date.now() - t0, 'ms ─────')
      return
    }
    console.log('[bunny] step 5: validation ok')

    console.log('[bunny] step 6: executing query against readonly DB...')
    const execStart = Date.now()
    const rows = await executeQuery(generated.sql)
    console.log(
      '[bunny] step 6: query returned',
      rows.length,
      'row(s) in',
      Date.now() - execStart,
      'ms',
    )
    if (rows.length > 0) {
      console.log('[bunny]   sample row:', JSON.stringify(rows[0]))
    }
    console.log('[bunny]: step 6: query execution complete', JSON.stringify(rows))

    console.log('[bunny] step 7: generating natural-language answer...')
    const answerStart = Date.now()
    const answer = await generateResponse({
      userMessage: message,
      queryResult: rows,
      role,
    })
    console.log('[bunny] step 7: answer generated in', Date.now() - answerStart, 'ms')
    console.log('[bunny]   answer preview:', answer.slice(0, 200))

    res.status(200).json({
      intent: intent.intent,
      answer,
      rowCount: rows.length,
    })
    console.log('[bunny] ───── done in', Date.now() - t0, 'ms ─────\n')
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    const stack = err instanceof Error ? err.stack : undefined
    console.error('[bunny] chat error after', Date.now() - t0, 'ms:', message)
    if (stack) console.error('[bunny] stack:', stack)
    res.status(500).json({ error: 'Something went wrong while answering your question.' })
  }
}
