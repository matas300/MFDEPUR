require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { injectUser } = require('./middleware/auth');
const cspNonce = require('./middleware/nonce');
const {
  ensureCsrfSession,
  injectCsrfToken,
  doubleCsrfProtection,
  csrfErrorHandler,
} = require('./middleware/csrf');
const orderCtrl = require('./controllers/orderController');

const app = express();

const IS_PROD = process.env.NODE_ENV === 'production';

// ── Trust proxy in prod (reverse proxy Nginx/Cloudflare/Hostinger) ────────────
// Necessario per req.secure, req.ip, cookie Secure e rate limit per-IP.
if (IS_PROD) {
  app.set('trust proxy', 1);
}

// ── Redirect HTTPS in prod ────────────────────────────────────────────────────
// Applicato PRIMA del webhook Stripe: anche i webhook devono arrivare in HTTPS.
if (IS_PROD) {
  app.use((req, res, next) => {
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') return next();
    return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
  });
}

// ── Stripe webhook (deve ricevere rawBody PRIMA di express.json) ──────────────
app.post('/stripe/webhook',
  express.raw({ type: 'application/json' }),
  (req, res, next) => { req.rawBody = req.body; next(); },
  orderCtrl.stripeWebhook
);

// ── Middleware ────────────────────────────────────────────────────────────────
// Nonce per CSP: deve stare PRIMA di helmet così la direttiva scriptSrc può leggerlo
app.use(cspNonce);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // scriptSrc: niente 'unsafe-inline'. Gli script inline richiedono nonce="<%= cspNonce %>".
      scriptSrc: [
        "'self'",
        (req, res) => `'nonce-${res.locals.cspNonce}'`,
        'js.stripe.com',
        'cdn.jsdelivr.net',
        'unpkg.com',
        'cdnjs.cloudflare.com',
      ],
      // styleSrc: 'unsafe-inline' ancora presente — molti template hanno style="..." inline.
      // TODO hardening: refactor degli inline style e passaggio a nonce/hash.
      styleSrc: ["'self'", "'unsafe-inline'", 'fonts.googleapis.com', 'cdnjs.cloudflare.com', 'unpkg.com'],
      fontSrc: ["'self'", 'fonts.gstatic.com', 'cdnjs.cloudflare.com', 'data:'],
      frameSrc: ['js.stripe.com'],
      imgSrc: ["'self'", 'data:', 'mfdepur.com', 'www.mfdepur.com', 'https:'],
      connectSrc: ["'self'", 'api.stripe.com'],
    },
  },
  // HSTS: 1 anno, includeSubDomains, preload. Attivo solo in prod — in dev
  // disattivato per non "appiccicare" localhost all'HTTPS nei browser.
  hsts: IS_PROD ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
  // Helmet aggiunge già X-Content-Type-Options, X-Frame-Options, Referrer-Policy.
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ── CSRF protection (double-submit cookie) ────────────────────────────────────
// Escluso da /stripe/webhook (montato prima di questo middleware)
app.use(ensureCsrfSession);
app.use(doubleCsrfProtection);
app.use(injectCsrfToken);

// Rate limiting
app.use('/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: 'Troppi tentativi, riprova tra 15 minuti.' }));
app.use('/auth/register', rateLimit({ windowMs: 60 * 60 * 1000, max: 5 }));
app.use('/auth/forgot-password', rateLimit({ windowMs: 60 * 60 * 1000, max: 5 }));

// ── Static files + uploads ────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../public')));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ── Template engine ───────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// ── Variabili globali per le view ─────────────────────────────────────────────
app.use(injectUser);
app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  res.locals.baseUrl = process.env.BASE_URL;
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────
// La homepage è il sito statico MFDEPUR (index.html in public/)
// — già servito da express.static sopra, nessuna route necessaria

app.use('/auth', require('./routes/auth'));
app.use('/shop', require('./routes/shop'));
app.use('/account', require('./routes/account'));
app.use('/admin', require('./routes/admin'));

// Pagine statiche
app.get('/privacy', (req, res) => res.render('privacy', { title: 'Privacy Policy' }));

// Sitemap dinamico
app.get('/sitemap.xml', require('./routes/sitemap'));

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('error', { message: 'Pagina non trovata', code: 404 });
});

// ── CSRF error handler (prima del generico) ──────────────────────────────────
app.use(csrfErrorHandler);

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err);
  const code = err.status || 500;
  const message = process.env.NODE_ENV === 'production' ? 'Errore interno del server' : err.message;
  if (req.accepts('json')) return res.status(code).json({ error: message });
  res.status(code).render('error', { message, code });
});

module.exports = app;
