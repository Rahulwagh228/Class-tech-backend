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
  try {
    const user = req.user
    if (!user) {
      res.status(401).json({ error: 'Authentication required' })
      return
    }

    const { message } = (req.body ?? {}) as { message?: unknown }
    if (typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ error: 'Body must include a non-empty "message" string' })
      return
    }

    const role = user.role as ChatbotRole
    const tutionId = user.tution_id
    const userId = user.id

    const intent = await classifyIntent(message)

    if (intent.intent === 'small_talk') {
      res.status(200).json({ intent: intent.intent, answer: SMALL_TALK_REPLY })
      return
    }
    if (intent.intent === 'help') {
      res.status(200).json({ intent: intent.intent, answer: HELP_REPLY })
      return
    }
    if (intent.intent === 'unsupported') {
      res.status(200).json({
        intent: intent.intent,
        answer: UNSUPPORTED_REPLY,
        reason: intent.reason,
      })
      return
    }

    const generated = await generateQuery({ message, role, tutionId, userId })
    if (!generated.ok) {
      res.status(200).json({
        intent: intent.intent,
        answer:
          "I couldn't translate that into a safe query. Could you rephrase or be more specific?",
        error: generated.error,
      })
      return
    }

    const check = validateSQL(generated.sql, tutionId)
    if (!check.valid) {
      res.status(200).json({
        intent: intent.intent,
        answer: "I couldn't run that safely. Could you rephrase your question?",
        error: check.reason,
      })
      return
    }

    const rows = await executeQuery(generated.sql)

    const answer = await generateResponse({
      userMessage: message,
      queryResult: rows,
      role,
    })

    res.status(200).json({
      intent: intent.intent,
      answer,
      rowCount: rows.length,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[bunny] chat error:', message)
    res.status(500).json({ error: 'Something went wrong while answering your question.' })
  }
}
