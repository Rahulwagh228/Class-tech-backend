import express from 'express'
import { requireAuth } from '../middleware/auth.js'
import { bunnyChatHandler } from '../controllers/bunny/chat.js'

const bunnyRouter = express.Router()

bunnyRouter.post('/chat', requireAuth, bunnyChatHandler)

export default bunnyRouter
