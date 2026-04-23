// src/config/env.js
// Valida all'avvio le env var critiche. Fail-fast (throw) se mancano o troppo corte.
// Importato come prima riga in server.js.

require('dotenv').config();

const REQUIRED = [
  // Auth / CSRF — almeno 32 char per entropy adeguata
  { name: 'JWT_SECRET',          minLength: 32 },
  { name: 'JWT_REFRESH_SECRET',  minLength: 32 },
  { name: 'CSRF_SECRET',         minLength: 32 },
  // Auth expiry — default string zod-like
  { name: 'JWT_EXPIRES_IN' },
  { name: 'JWT_REFRESH_EXPIRES_IN' },
  // Stripe — fail-fast sempre (no fallback silent)
  { name: 'STRIPE_SECRET_KEY' },
  { name: 'STRIPE_PUBLISHABLE_KEY' },
  { name: 'STRIPE_WEBHOOK_SECRET' },
  // DB
  { name: 'DATABASE_URL' },
];

const RECOMMENDED = [
  // Email — se mancano, le email non partono (warning, non fatal)
  'EMAIL_HOST', 'EMAIL_PORT', 'EMAIL_USER', 'EMAIL_PASS', 'EMAIL_FROM',
  'BASE_URL', 'ADMIN_EMAIL',
];

function validate() {
  const missing = [];
  const tooShort = [];

  for (const { name, minLength } of REQUIRED) {
    const v = process.env[name];
    if (!v || v.length === 0) {
      missing.push(name);
      continue;
    }
    if (minLength && v.length < minLength) {
      tooShort.push(`${name} (${v.length} char, richiesti ${minLength})`);
    }
  }

  if (missing.length || tooShort.length) {
    const lines = [
      'Configurazione env non valida. Impossibile avviare.',
      '',
      missing.length  ? `  Mancanti: ${missing.join(', ')}` : null,
      tooShort.length ? `  Troppo corte: ${tooShort.join(', ')}` : null,
      '',
      'Genera segreti con:  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
      'Vedi .env.example per lista completa.',
    ].filter(Boolean).join('\n');
    console.error('\n' + lines + '\n');
    process.exit(1);
  }

  const warnings = RECOMMENDED.filter(n => !process.env[n]);
  if (warnings.length) {
    console.warn(`⚠ env opzionali mancanti: ${warnings.join(', ')} — alcune feature potrebbero non funzionare.`);
  }
}

validate();

module.exports = { validate };
