import express from 'express';
import pino from 'pino';
import type { NextFunction, Request, Response } from 'express';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { authRouter } from './routes/auth.js';

const logger = pino({ level: env.LOG_LEVEL });

export const app = express();

app.use((request: Request, response: Response, next: NextFunction) => {
  const startedAt = Date.now();

  response.on('finish', () => {
    logger.info(
      {
        method: request.method,
        path: request.originalUrl,
        statusCode: response.statusCode,
        durationMs: Date.now() - startedAt
      },
      'request completed'
    );
  });

  next();
});

app.use(express.json());

app.get('/', (_request, response) => {
  response.json({ message: 'Class Tech API' });
});

app.use('/api/v1/auth', authRouter);

app.use(notFoundHandler);
app.use(errorHandler);