// src/utils/emailLogger.js
// Logga le failure di invio email: console + AuditLog-like tabella DB.

const prisma = require('../config/database');
const observability = require('./observability');

async function logEmailFailure({ to, subject, templateName, err, context = {} }) {
  const errorMessage = err?.message || String(err);
  const errorCode    = err?.code ? String(err.code) : null;
  console.error(`[email-failure] to=${to} template=${templateName || 'unknown'} err=${errorMessage}`);
  observability.captureException(err instanceof Error ? err : new Error(errorMessage),
    { kind: 'email-send-failure', to, subject, templateName, ...context });
  try {
    await prisma.emailFailureLog.create({
      data: {
        toAddress: to,
        subject: subject?.slice(0, 200) || 'unknown',
        templateName: templateName?.slice(0, 80) || null,
        errorMessage: errorMessage.slice(0, 1000),
        errorCode,
        context: Object.keys(context).length ? JSON.stringify(context).slice(0, 2000) : null,
      },
    });
  } catch (logErr) {
    // Ultimo fallback: se anche il DB è giù, almeno console ha loggato.
    console.error('[email-failure] impossibile persistere log:', logErr.message);
  }
}

module.exports = { logEmailFailure };
