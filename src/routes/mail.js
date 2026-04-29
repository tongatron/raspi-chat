"use strict";

const { sendContactMail } = require("../services/mail-service");
const { sendTelegramNotification } = require("../services/telegram-service");

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

async function mailRoutes(app) {
  app.post("/api/send-mail", async (request, reply) => {
    const body = request.body || {};
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim();
    const subject = String(body.subject || "").trim();
    const message = String(body.message || "").trim();

    if (!name || !email || !message) {
      return reply.code(400).send({ ok: false, error: "Campi obbligatori: name, email, message" });
    }

    if (!isEmail(email)) {
      return reply.code(400).send({ ok: false, error: "Email non valida" });
    }

    const mailSubject = subject || `Messaggio da ${name} via tongatron.org`;

    try {
      await sendContactMail({
        name,
        email,
        subject: mailSubject,
        message,
      });

      let telegram = { ok: false, skipped: true };
      try {
        telegram = await sendTelegramNotification({
          name,
          email,
          subject: subject || mailSubject,
          message,
        });
      } catch (error) {
        request.log.warn({ err: error }, "Telegram notification send failed");
      }

      request.log.info({ fromEmail: email, fromName: name }, "Contact mail sent");
      return { ok: true, telegramOk: telegram.ok === true, telegramSkipped: telegram.skipped === true };
    } catch (error) {
      if (error.code === "MAIL_NOT_CONFIGURED") {
        request.log.error("Mail route not configured: missing GMAIL_USER/GMAIL_APP_PASSWORD/MAIL_TO");
        return reply.code(503).send({ ok: false, error: "Servizio email non configurato" });
      }
      request.log.error({ err: error }, "Contact mail send failed");
      return reply.code(500).send({ ok: false, error: "Errore invio email. Riprova." });
    }
  });
}

module.exports = mailRoutes;
