import { createServer } from 'node:http';
import { app } from './app.js';
import { env } from './config/env.js';

// On Vercel (and similar serverless), the app is invoked per-request as a
// handler - never bind to a port. We detect Vercel via env var and skip listen.
if (!process.env.VERCEL) {
  const server = createServer(app);

  server.listen(env.PORT, () => {
    console.log(`Server listening on port ${env.PORT}`);
  });

  const shutdown = (signal: string) => {
    console.log(`${signal} received, shutting down`);
    server.close(() => {
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Default export so this file ALSO works as a Vercel function entry,
// in case Vercel auto-detects it via package.json#main.
export default app;
