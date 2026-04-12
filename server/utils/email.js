const { Resend } = require('resend');

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
const PUBLIC_URL = process.env.PUBLIC_URL || 'http://localhost:5173';

/**
 * Send an email verification link to a newly registered venue owner.
 * @param {string} to - recipient email
 * @param {string} token - verification token
 * @param {string} venueName - venue name for personalization
 */
async function sendVerificationEmail(to, token, venueName) {
  if (!resend) {
    console.warn('[EMAIL] RESEND_API_KEY not set — skipping verification email');
    return;
  }

  const verifyUrl = `${PUBLIC_URL}/verify-email?token=${encodeURIComponent(token)}`;

  await resend.emails.send({
    from: `Speeldit <${FROM}>`,
    to,
    subject: 'Verify your Speeldit account',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 16px;">
        <h2 style="color: #18181b; margin-bottom: 8px;">Welcome to Speeldit!</h2>
        <p style="color: #52525b; font-size: 15px; line-height: 1.6;">
          You registered <strong>${escapeHtml(venueName)}</strong>. Please verify your email to activate your account.
        </p>
        <a href="${verifyUrl}"
           style="display: inline-block; margin: 24px 0; padding: 14px 32px; background-color: #7012D4; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px;">
          Verify my email
        </a>
        <p style="color: #71717a; font-size: 13px; line-height: 1.5;">
          Or copy this link into your browser:<br/>
          <span style="color: #7012D4; word-break: break-all;">${verifyUrl}</span>
        </p>
        <p style="color: #a1a1aa; font-size: 12px; margin-top: 32px;">
          This link expires in 24 hours. If you didn't register, you can ignore this email.
        </p>
      </div>
    `,
  });
}

/**
 * Send a password reset link.
 * @param {string} to - recipient email
 * @param {string} token - reset token
 */
async function sendPasswordResetEmail(to, token) {
  if (!resend) {
    console.warn('[EMAIL] RESEND_API_KEY not set — skipping password reset email');
    return;
  }

  const resetUrl = `${PUBLIC_URL}/reset-password?token=${encodeURIComponent(token)}`;

  await resend.emails.send({
    from: `Speeldit <${FROM}>`,
    to,
    subject: 'Reset your Speeldit password',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 16px;">
        <h2 style="color: #18181b; margin-bottom: 8px;">Password reset</h2>
        <p style="color: #52525b; font-size: 15px; line-height: 1.6;">
          Someone requested a password reset for your Speeldit account. Click the button below to choose a new password.
        </p>
        <a href="${resetUrl}"
           style="display: inline-block; margin: 24px 0; padding: 14px 32px; background-color: #7012D4; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px;">
          Reset my password
        </a>
        <p style="color: #71717a; font-size: 13px; line-height: 1.5;">
          Or copy this link into your browser:<br/>
          <span style="color: #7012D4; word-break: break-all;">${resetUrl}</span>
        </p>
        <p style="color: #a1a1aa; font-size: 12px; margin-top: 32px;">
          This link expires in 1 hour. If you didn't request this, you can ignore this email — your password won't change.
        </p>
      </div>
    `,
  });
}

/** Basic HTML escaping to prevent XSS in email templates. */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
