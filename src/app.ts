import cors from 'cors';
import express from 'express';
import pino from 'pino';
import type { NextFunction, Request, Response } from 'express';
import { env } from './config/env.js';
import { supabaseStatus } from './config/connectSupabase.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { adminRouter } from './routes/admin.routes.js';
import { authRouter } from './routes/auth.routes.js';
import { parentRouter } from './routes/parent.routes.js';
import { studentRouter } from './routes/student.routes.js';
import { teacherRouter } from './routes/teacher.routes.js';
import { uploadRouter } from './routes/upload.routes.js';
import KobiRouter from './routes/kobi.js';
import bunnyRouter from './routes/bunny.js';

const logger = pino({ level: env.LOG_LEVEL });

export const app = express();


const allowedOrigins = new Set<string>([
  env.APP_URL,                           // whatever you set in .env (defaults to http://localhost:3000)
  'http://localhost:3000',
  // 'http://localhost:3001',
  // 'http://localhost:5173',
  // 'http://10.138.76.189:5000',               // Vite default
  // production frontend
  'https://class-tech-sooty.vercel.app',
  'https://classsly.in',
]);

// Match every Vercel preview URL for the frontend project so PR/branch deploys work.
const allowedOriginPatterns: RegExp[] = [
  /^https:\/\/classsly(-[a-z0-9-]+)?\.in$/
];

app.use(
  cors({
    origin(origin, callback) {
      // allow same-origin / curl / Postman (no Origin header)
      if (!origin) return callback(null, true);
      if (allowedOrigins.has(origin)) return callback(null, true);
      if (allowedOriginPatterns.some((re) => re.test(origin))) return callback(null, true);

      console.warn(`[cors] blocked origin: ${origin}`);
      return callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })
);

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

// Always-available health probe - never touches DB or external services.
// app.get('/health', (_request, response) => {
//   response.json({ status: 'ok', timestamp: new Date().toISOString() });
// });

// Diagnostic - shows which env vars Vercel actually has (booleans only,
// never the values). Use this to debug FUNCTION_INVOCATION_FAILED.
app.get('/_diag', (_request, response) => {
  response.json({
    runtime: 'ok',
    node: process.version,
    env: {
      NODE_ENV: env.NODE_ENV,
      has_JWT_SECRET: !!env.JWT_SECRET,
      has_RESEND_API_KEY: !!env.RESEND_API_KEY,
      has_EMAIL_FROM: !!env.EMAIL_FROM,
      has_APP_URL: !!env.APP_URL,
      has_SUPABASE_URL: !!(env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL),
      has_SUPABASE_PUBLISHABLE_KEY: !!(
        env.SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
      ),
      has_SUPABASE_SERVICE_ROLE_KEY: !!env.SUPABASE_SERVICE_ROLE_KEY
    },
    supabase: supabaseStatus()
  });
});

app.use('/api/v1/auth', authRouter);
app.use('/api/v1/admin', adminRouter);
app.use('/api/v1/teacher', teacherRouter);
app.use('/api/v1/student', studentRouter);
app.use('/api/v1/parent', parentRouter);
app.use('/api/v1/uploads', uploadRouter);
app.use('/kobi', KobiRouter);
app.use('/api/v1/bunny', bunnyRouter);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;