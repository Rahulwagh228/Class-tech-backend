import { Resend } from 'resend';
import { env } from '../config/env.js';

const resend = new Resend(env.RESEND_API_KEY);

export async function sendVerificationEmail(to: string, name: string, token: string): Promise<void> {
  const verifyUrl = `${env.APP_URL}/api/v1/auth/verify-email?token=${encodeURIComponent(token)}`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
      <h2>Welcome to Class Tech, ${escapeHtml(name)}!</h2>
      <p>Please verify your email address to finish setting up your account.</p>
      <p>
        <a href="${verifyUrl}"
           style="display:inline-block;padding:12px 20px;background:#2563eb;color:#fff;
                  text-decoration:none;border-radius:6px;">
          Verify email
        </a>
      </p>
      <p>Or paste this link into your browser:<br><a href="${verifyUrl}">${verifyUrl}</a></p>
      <p style="color:#666;font-size:12px;">This link expires in 24 hours.</p>
    </div>
  `;

  await resend.emails.send({
    from: env.EMAIL_FROM,
    to,
    subject: 'Verify your Class Tech email',
    html
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
