"use strict";

const nodemailer = require("nodemailer");

const SMTP_USER = String(process.env.GMAIL_USER || "").trim();
const SMTP_PASS = String(process.env.GMAIL_APP_PASSWORD || "").trim();
const MAIL_TO = String(process.env.MAIL_TO || SMTP_USER).trim();

let transporter = null;

function escHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

function getTransporter() {
  if (!SMTP_USER || !SMTP_PASS || !MAIL_TO) return null;
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });

  return transporter;
}

function buildContactMailHtml({ name, email, subject, message }) {
  return `
    <div style="font-family:sans-serif;max-width:600px">
      <h2 style="color:#333">Nuovo messaggio dal sito</h2>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:8px;font-weight:bold;width:100px">Nome</td><td style="padding:8px">${escHtml(name)}</td></tr>
        <tr style="background:#f5f5f5"><td style="padding:8px;font-weight:bold">Email</td><td style="padding:8px"><a href="mailto:${escHtml(email)}">${escHtml(email)}</a></td></tr>
        <tr><td style="padding:8px;font-weight:bold">Oggetto</td><td style="padding:8px">${escHtml(subject)}</td></tr>
      </table>
      <div style="margin-top:16px;padding:16px;background:#f9f9f9;border-left:4px solid #4CAF50;border-radius:4px;white-space:pre-wrap">${escHtml(message)}</div>
      <p style="color:#999;font-size:12px;margin-top:24px">Inviato da fastify-api</p>
    </div>
  `;
}

async function sendContactMail({ name, email, subject, message }) {
  const transport = getTransporter();
  if (!transport) {
    const error = new Error("Mail service not configured");
    error.code = "MAIL_NOT_CONFIGURED";
    throw error;
  }

  await transport.sendMail({
    from: `"Tongatron Site" <${SMTP_USER}>`,
    to: MAIL_TO,
    replyTo: `"${name.replace(/"/g, "")}" <${email}>`,
    subject,
    html: buildContactMailHtml({ name, email, subject, message }),
  });
}

module.exports = {
  sendContactMail,
  buildContactMailHtml,
};
