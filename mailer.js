'use strict';

/**
 * mailer.js — thin email wrapper for Starpush
 *
 * Configure via env vars:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 *   SMTP_FROM  (defaults to "Starpush <clujkeebs@aol.com>")
 *
 * Works with:
 *   - Gmail: SMTP_HOST=smtp.gmail.com, SMTP_PORT=587
 *             SMTP_USER=you@gmail.com, SMTP_PASS=<app-password>
 *   - Any transactional SMTP (SendGrid, Resend, Postmark, etc.)
 *
 * If env vars are not set, emails are logged to console only (dev mode).
 */

const nodemailer = require('nodemailer');

const isConfigured = !!(
  process.env.SMTP_HOST &&
  process.env.SMTP_USER &&
  process.env.SMTP_PASS
);

const transporter = isConfigured
  ? nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    })
  : null;

const FROM = process.env.SMTP_FROM || 'Starpush <clujkeebs@aol.com>';

/**
 * Send an email. Falls back to console.log if SMTP is not configured.
 * @param {{ to: string, subject: string, html: string, text?: string }} opts
 */
async function sendMail({ to, subject, html, text }) {
  if (!isConfigured) {
    console.log(`[Email - no SMTP configured] To: ${to} | Subject: ${subject}`);
    if (text) console.log(text);
    return;
  }
  try {
    await transporter.sendMail({ from: FROM, to, subject, html, text });
  } catch (err) {
    console.error(`[Email] Failed to send to ${to}:`, err.message);
  }
}

/**
 * Send a password reset email.
 */
function sendPasswordReset(email, resetUrl) {
  return sendMail({
    to:      email,
    subject: 'Reset your Starpush password',
    text:    `Click the link below to reset your password. It expires in 1 hour.\n\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email.`,
    html: `
      <div style="font-family:Inter,system-ui,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#f9fafb">
        <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e7eb">
          <div style="font-size:20px;font-weight:800;color:#0d2137;margin-bottom:8px">🚀 Starpush</div>
          <h1 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 12px">Reset your password</h1>
          <p style="color:#374151;margin:0 0 24px;line-height:1.6">
            We received a request to reset your Starpush password. Click the button below — this link expires in <strong>1 hour</strong>.
          </p>
          <a href="${resetUrl}"
             style="display:inline-block;background:#4f46e5;color:#fff;font-weight:700;font-size:15px;padding:14px 28px;border-radius:8px;text-decoration:none;margin-bottom:24px">
            Reset my password →
          </a>
          <p style="color:#9ca3af;font-size:13px;margin:0">
            If you didn't request a password reset, you can safely ignore this email. Your password will not change.
          </p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0" />
          <p style="color:#9ca3af;font-size:12px;margin:0">
            starpush.io by clujkeebs · <a href="https://starpush.io" style="color:#6b7280">starpush.io</a> ·
            <a href="mailto:clujkeebs@aol.com" style="color:#6b7280">clujkeebs@aol.com</a>
          </p>
        </div>
      </div>
    `,
  });
}

/**
 * Send a welcome email to a new signup.
 */
function sendWelcome(email, name) {
  return sendMail({
    to:      email,
    subject: `Welcome to Starpush, ${name.split(' ')[0]}! 🚀`,
    text:    `Hi ${name.split(' ')[0]},\n\nYour Starpush account is ready. Log in at https://starpush.io/login to start sending review requests and dominating Google Maps.\n\nIf you need help, reply to this email — I personally read every message.\n\n— The Starpush Team`,
    html: `
      <div style="font-family:Inter,system-ui,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#f9fafb">
        <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e7eb">
          <div style="font-size:20px;font-weight:800;color:#0d2137;margin-bottom:8px">🚀 Starpush</div>
          <h1 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 12px">
            You're in, ${name.split(' ')[0]}! 🎉
          </h1>
          <p style="color:#374151;margin:0 0 16px;line-height:1.6">
            Your 14-day free trial is active. Here's how to get your first review <strong>today</strong>:
          </p>
          <ol style="color:#374151;padding-left:20px;margin:0 0 24px;line-height:1.8">
            <li>Go to your <strong><a href="https://starpush.io/dashboard" style="color:#4f46e5">dashboard</a></strong></li>
            <li>Save your Google review link in <a href="https://starpush.io/account" style="color:#4f46e5">Account Settings</a></li>
            <li>Enter a customer name + phone and hit <strong>Send via SMS</strong></li>
          </ol>
          <a href="https://starpush.io/dashboard"
             style="display:inline-block;background:#4f46e5;color:#fff;font-weight:700;font-size:15px;padding:14px 28px;border-radius:8px;text-decoration:none;margin-bottom:24px">
            Go to my dashboard →
          </a>
          <p style="color:#9ca3af;font-size:13px;margin:0;line-height:1.6">
            Questions? Just reply to this email — I read every one personally.
          </p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0" />
          <p style="color:#9ca3af;font-size:12px;margin:0">
            starpush.io by clujkeebs · <a href="https://starpush.io" style="color:#6b7280">starpush.io</a> ·
            <a href="mailto:clujkeebs@aol.com" style="color:#6b7280">clujkeebs@aol.com</a>
          </p>
        </div>
      </div>
    `,
  });
}

module.exports = { sendMail, sendPasswordReset, sendWelcome };
