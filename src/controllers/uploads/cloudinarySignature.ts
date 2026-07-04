import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import { env } from '../../config/env.js';

// =============================================================================
// GET /api/v1/uploads/cloudinary-signature   (auth required)
//
// Returns a short-lived Cloudinary upload signature. The API secret stays on
// the server; the browser POSTs directly to Cloudinary using the returned
// { signature, timestamp, api_key, cloudName } plus the file itself.
//
// Optional query params (any Cloudinary upload param can be added here later,
// as long as it is BOTH signed on the server AND sent by the client):
//   ?folder=students-avatars
//   ?public_id=user_123
//
// Response 200:
//   {
//     cloudName: string,
//     apiKey:    string,
//     timestamp: number,   // unix seconds
//     signature: string,   // sha1 hex
//     folder?:   string,
//     publicId?: string
//   }
//
// Errors:
//   401 — not authenticated
//   500 — Cloudinary env vars are not configured on the server
// =============================================================================
export const cloudinarySignature = (req: Request, res: Response): void => {
  if (!req.user) {
    res.status(401).json({ msg: 'Authentication required' });
    return;
  }

  const cloudName = env.CLOUDINARY_CLOUD_NAME;
  const apiKey = env.CLOUDINARY_API_KEY;
  const apiSecret = env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    res.status(500).json({
      msg: 'Cloudinary is not configured on the server',
      code: 'CLOUDINARY_NOT_CONFIGURED'
    });
    return;
  }

  const folder =
    typeof req.query.folder === 'string' && req.query.folder.length > 0
      ? req.query.folder
      : undefined;
  const publicId =
    typeof req.query.public_id === 'string' && req.query.public_id.length > 0
      ? req.query.public_id
      : undefined;

  const timestamp = Math.floor(Date.now() / 1000);

  // Every non-file param sent to Cloudinary EXCEPT api_key, signature,
  // cloud_name, resource_type, and file itself must be included in the
  // signature. If you add fields (eg. eager, tags), add them here too and
  // send them from the browser with the exact same values.
  const params: Record<string, string | number> = { timestamp };
  if (folder) params.folder = folder;
  if (publicId) params.public_id = publicId;

  const signature = signParams(params, apiSecret);

  res.status(200).json({
    cloudName,
    apiKey,
    timestamp,
    signature,
    ...(folder ? { folder } : {}),
    ...(publicId ? { publicId } : {})
  });
};

// Cloudinary's rule: sort keys alphabetically, concat `k=v&k=v`, append the
// secret, then SHA-1 the whole thing.
function signParams(
  params: Record<string, string | number>,
  secret: string
): string {
  const toSign = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return crypto.createHash('sha1').update(toSign + secret).digest('hex');
}
