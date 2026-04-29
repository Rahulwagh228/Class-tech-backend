// Vercel serverless entry point.
// Express apps are valid Node request handlers - exporting it lets Vercel's
// @vercel/node runtime invoke the whole router per request.
import { app } from '../src/app.js';

export default app;
