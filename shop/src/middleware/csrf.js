const crypto = require('crypto');
const { doubleCsrf } = require('csrf-csrf');

const isProd = process.env.NODE_ENV === 'production';
const CSRF_SECRET = process.env.CSRF_SECRET;
if (!CSRF_SECRET || CSRF_SECRET.length < 32) {
  throw new Error('CSRF_SECRET mancante o troppo corto (min 32 caratteri) — settalo in .env');
}

// Cookie anonimo usato come session identifier per il double-submit
// (serve anche per guest che non hanno sessione)
function ensureCsrfSession(req, res, next) {
  if (!req.cookies?.csrfSession) {
    const id = crypto.randomBytes(32).toString('hex');
    res.cookie('csrfSession', id, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    req.cookies.csrfSession = id;
  }
  next();
}

const { generateCsrfToken, doubleCsrfProtection, invalidCsrfTokenError } = doubleCsrf({
  getSecret: () => CSRF_SECRET,
  getSessionIdentifier: (req) => req.cookies?.csrfSession || '',
  cookieName: isProd ? '__Host-csrf' : 'csrf',
  cookieOptions: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
  },
  size: 32,
  ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
  getCsrfTokenFromRequest: (req) =>
    req.headers['x-csrf-token'] || req.body?._csrf,
});

// Genera token fresco ad ogni request GET e lo espone alle view
function injectCsrfToken(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') {
    try {
      res.locals.csrfToken = generateCsrfToken(req, res);
    } catch (_) {
      res.locals.csrfToken = '';
    }
  } else {
    res.locals.csrfToken = res.locals.csrfToken || '';
  }
  next();
}

// Error handler dedicato per restituire 403 HTML/JSON invece di 500
function csrfErrorHandler(err, req, res, next) {
  if (err === invalidCsrfTokenError || err?.code === 'EBADCSRFTOKEN' || err?.code === 'ERR_BAD_CSRF_TOKEN') {
    if (req.accepts('json') && !req.accepts('html')) {
      return res.status(403).json({ error: 'CSRF token non valido' });
    }
    return res.status(403).render('error', {
      message: 'Sessione scaduta o token non valido. Ricarica la pagina e riprova.',
      code: 403,
    });
  }
  next(err);
}

module.exports = {
  ensureCsrfSession,
  injectCsrfToken,
  doubleCsrfProtection,
  csrfErrorHandler,
};
