// src/utils/observability.js
// Wrapper Sentry opt-in. Se SENTRY_DSN non è settata, tutte le funzioni sono no-op.
// Così dev/CI non richiedono DSN.

let Sentry = null;
let enabled = false;

function init() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  try {
    Sentry = require('@sentry/node');
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'development',
      release: process.env.APP_VERSION || undefined,
      tracesSampleRate: 0, // no APM per ora
    });
    enabled = true;
    console.log('📡 Sentry inizializzato');
  } catch (err) {
    console.warn('⚠ Sentry non disponibile (@sentry/node non installato?):', err.message);
  }
}

function captureException(err, context = {}) {
  if (!enabled) return;
  Sentry.captureException(err, { extra: context });
}

function errorHandler() {
  // Middleware Express 4 compatibile. No-op se Sentry non attivo.
  if (!enabled) return (err, req, res, next) => next(err);
  return Sentry.Handlers.errorHandler();
}

function requestHandler() {
  if (!enabled) return (req, res, next) => next();
  return Sentry.Handlers.requestHandler();
}

module.exports = { init, captureException, errorHandler, requestHandler };
