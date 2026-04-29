const jwt = require('jsonwebtoken');
const prisma = require('../config/database');

// Verifica access token — protegge le route autenticate
async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.accessToken || req.headers.authorization?.split(' ')[1];
    if (!token) {
      if (req.accepts('html')) return res.redirect('/auth/login');
      return res.status(401).json({ error: 'Non autenticato' });
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { company: true },
    });

    if (!user) {
      if (req.accepts('html')) return res.redirect('/auth/login');
      return res.status(401).json({ error: 'Utente non trovato' });
    }

    req.user = user;
    next();
  } catch (err) {
    if (req.accepts('html')) return res.redirect('/auth/login');
    return res.status(401).json({ error: 'Token non valido o scaduto' });
  }
}

// Solo admin
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'ADMIN') {
    if (req.accepts('html')) return res.status(403).render('error', { message: 'Accesso negato', code: 403 });
    return res.status(403).json({ error: 'Accesso negato' });
  }
  next();
}

// Verifica companyRole. Bypass per ADMIN globale (super-user di sistema).
function requireCompanyRole(roles) {
  const allowed = Array.isArray(roles) ? roles : [roles];
  return (req, res, next) => {
    if (!req.user) {
      if (req.accepts && req.accepts('html')) return res.redirect('/auth/login');
      return res.status(401).json({ error: 'Non autenticato' });
    }
    if (req.user.role === 'ADMIN') return next();
    if (!req.user.companyId || !allowed.includes(req.user.companyRole)) {
      if (req.accepts && req.accepts('html')) {
        return res.status(403).render('error', { message: 'Accesso negato', code: 403 });
      }
      return res.status(403).json({ error: 'Accesso negato' });
    }
    next();
  };
}

// Azienda approvata — i customer devono avere company APPROVED
function requireApprovedCompany(req, res, next) {
  if (req.user.role === 'ADMIN') return next();
  if (!req.user.company || req.user.company.status !== 'APPROVED') {
    if (req.accepts('html')) {
      return res.render('auth/pending', { user: req.user });
    }
    return res.status(403).json({ error: 'La tua azienda è in attesa di approvazione' });
  }
  next();
}

// Inietta user nella res.locals per le view EJS (senza bloccare)
async function injectUser(req, res, next) {
  try {
    const token = req.cookies?.accessToken;
    if (token) {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        include: { company: true },
      });
      res.locals.user = user;
      res.locals.currentUser = user; // alias usato dalle views

      // Conteggio items nel carrello per il badge navbar
      if (user) {
        const cart = await prisma.cart.findUnique({
          where: { userId: user.id },
          include: { items: true },
        });
        res.locals.cartCount = cart ? cart.items.reduce((s, i) => s + i.quantity, 0) : 0;
      }
    }
  } catch (_) {
    // token scaduto o invalido — ignora silenziosamente
  }
  res.locals.user = res.locals.user || null;
  res.locals.currentUser = res.locals.currentUser || null;
  res.locals.cartCount = res.locals.cartCount || 0;
  next();
}

module.exports = { requireAuth, requireAdmin, requireCompanyRole, requireApprovedCompany, injectUser };
