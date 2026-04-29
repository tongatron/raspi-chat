"use strict";

const TELEGRAM_BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || process.env.TG_TOKEN || "").trim();
const TELEGRAM_CHAT_ID = String(process.env.TELEGRAM_CHAT_ID || process.env.TG_CHAT_ID || "").trim();
const TELEGRAM_API_BASE = String(process.env.TELEGRAM_API_BASE || "https://api.telegram.org").trim().replace(/\/$/, "");

function escTelegramHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildTelegramContactText({ name, email, subject, message }) {
  const lines = [
    "<b>Nuovo messaggio dal sito Tongatron</b>",
    "",
    `<b>Nome:</b> ${escTelegramHtml(name)}`,
    `<b>Email:</b> ${escTelegramHtml(email)}`,
  ];

  if (subject) {
    lines.push(`<b>Oggetto:</b> ${escTelegramHtml(subject)}`);
  }

  lines.push("");
  lines.push(escTelegramHtml(message));

  return lines.join("\n");
}

async function sendTelegramMessage(text, options = {}) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    return { ok: false, skipped: true, reason: "missing TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID" };
  }

  const response = await fetch(`${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: options.parseMode || "HTML",
      disable_web_page_preview: options.disableWebPagePreview !== false,
    }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    const error = new Error("Telegram send failed");
    error.details = data;
    error.status = response.status;
    throw error;
  }

  return { ok: true };
}

async function sendTelegramNotification(payload) {
  return sendTelegramMessage(buildTelegramContactText(payload), {
    parseMode: "HTML",
    disableWebPagePreview: true,
  });
}

module.exports = {
  sendTelegramMessage,
  sendTelegramNotification,
  buildTelegramContactText,
};
