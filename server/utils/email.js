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

/**
 * Trial-started confirmation. Sent after Paystack authorises the card.
 */
async function sendTrialStartedEmail(to, { venueName, trialEndsAt, amountZar }) {
  if (!resend) {
    console.warn('[EMAIL] RESEND_API_KEY not set — skipping trial-started email');
    return;
  }
  const billingUrl = `${PUBLIC_URL}/venue/billing`;
  const endsDate = new Date(trialEndsAt).toLocaleDateString('en-ZA', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
  await resend.emails.send({
    from: `Speeldit <${FROM}>`,
    to,
    subject: 'Your Speeldit trial has started',
    html: emailShell(`
      <h2 style="color:#18181b;margin-bottom:8px;">Your 14-day trial is live</h2>
      <p style="color:#52525b;font-size:15px;line-height:1.6;">
        <strong>${escapeHtml(venueName)}</strong> now has full access to Speeldit.
        Your trial runs until <strong>${endsDate}</strong>. If you don't cancel before that date,
        we'll charge R${amountZar} to the card you just added, and monthly on the same date after that.
      </p>
      <a href="${billingUrl}" style="${btnStyle()}">Manage subscription</a>
      <p style="color:#71717a;font-size:13px;line-height:1.5;">
        You can cancel anytime during the trial in your billing page — no charge.
      </p>
    `),
  });
}

/**
 * Trial ending reminder. Send 3 days before trialEndsAt.
 */
async function sendTrialEndingEmail(to, { venueName, trialEndsAt, amountZar }) {
  if (!resend) return;
  const billingUrl = `${PUBLIC_URL}/venue/billing`;
  const endsDate = new Date(trialEndsAt).toLocaleDateString('en-ZA', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
  await resend.emails.send({
    from: `Speeldit <${FROM}>`,
    to,
    subject: `Your Speeldit trial ends on ${endsDate}`,
    html: emailShell(`
      <h2 style="color:#18181b;margin-bottom:8px;">Trial ending soon</h2>
      <p style="color:#52525b;font-size:15px;line-height:1.6;">
        Your trial for <strong>${escapeHtml(venueName)}</strong> ends on <strong>${endsDate}</strong>.
        On that date we'll charge <strong>R${amountZar}</strong> and continue billing monthly.
      </p>
      <a href="${billingUrl}" style="${btnStyle()}">Manage subscription</a>
      <p style="color:#71717a;font-size:13px;line-height:1.5;">
        If you'd like to cancel, you can do so now from the billing page. No charge will be made.
      </p>
    `),
  });
}

/**
 * Charge receipt — sent on charge.success webhook for subscription invoices.
 */
async function sendSubscriptionReceiptEmail(to, { venueName, amountZar, nextPaymentDate }) {
  if (!resend) return;
  const billingUrl = `${PUBLIC_URL}/venue/billing`;
  const nextDate = nextPaymentDate
    ? new Date(nextPaymentDate).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })
    : '—';
  await resend.emails.send({
    from: `Speeldit <${FROM}>`,
    to,
    subject: `Receipt — R${amountZar} Speeldit subscription`,
    html: emailShell(`
      <h2 style="color:#18181b;margin-bottom:8px;">Payment received</h2>
      <p style="color:#52525b;font-size:15px;line-height:1.6;">
        We charged <strong>R${amountZar}</strong> to your card on file for <strong>${escapeHtml(venueName)}</strong>.
        Your next billing date is <strong>${nextDate}</strong>.
      </p>
      <a href="${billingUrl}" style="${btnStyle()}">View billing</a>
    `),
  });
}

/**
 * Payment failed — sent on invoice.payment_failed webhook.
 */
async function sendSubscriptionPaymentFailedEmail(to, { venueName, amountZar }) {
  if (!resend) return;
  const billingUrl = `${PUBLIC_URL}/venue/billing`;
  await resend.emails.send({
    from: `Speeldit <${FROM}>`,
    to,
    subject: `Action needed: Speeldit payment failed for ${venueName}`,
    html: emailShell(`
      <h2 style="color:#b91c1c;margin-bottom:8px;">Payment failed</h2>
      <p style="color:#52525b;font-size:15px;line-height:1.6;">
        We couldn't charge <strong>R${amountZar}</strong> for <strong>${escapeHtml(venueName)}</strong>.
        Please update your card to keep your dashboard active. Access will be suspended if the payment isn't resolved.
      </p>
      <a href="${billingUrl}" style="${btnStyle()}">Update payment method</a>
    `),
  });
}

/**
 * Subscription canceled confirmation.
 */
async function sendSubscriptionCanceledEmail(to, { venueName }) {
  if (!resend) return;
  await resend.emails.send({
    from: `Speeldit <${FROM}>`,
    to,
    subject: 'Your Speeldit subscription has been canceled',
    html: emailShell(`
      <h2 style="color:#18181b;margin-bottom:8px;">Subscription canceled</h2>
      <p style="color:#52525b;font-size:15px;line-height:1.6;">
        We've canceled the Speeldit subscription for <strong>${escapeHtml(venueName)}</strong>.
        You won't be charged again. Your dashboard access will end at the end of the current billing period.
      </p>
      <p style="color:#71717a;font-size:13px;line-height:1.5;">
        Changed your mind? Reply to this email — we can reactivate in seconds.
      </p>
    `),
  });
}

/** Shared email wrapper. */
function emailShell(innerHtml) {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 16px;">
      ${innerHtml}
    </div>
  `;
}

function btnStyle() {
  return 'display:inline-block;margin:24px 0;padding:14px 32px;background-color:#7012D4;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;';
}

/** Basic HTML escaping to prevent XSS in email templates. */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendTrialStartedEmail,
  sendTrialEndingEmail,
  sendSubscriptionReceiptEmail,
  sendSubscriptionPaymentFailedEmail,
  sendSubscriptionCanceledEmail,
};
