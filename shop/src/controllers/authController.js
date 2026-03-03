const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { validationResult } = require('express-validator');
const prisma = require('../config/database');
const email = require('../utils/email');

function generateAccessToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '15m' });
}

function generateRefreshToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' });
}

function setTokenCookies(res, accessToken, refreshToken) {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie('accessToken', accessToken, {
    httpOnly: true, secure: isProd, sameSite: 'lax',
    maxAge: 15 * 60 * 1000, // 15 minuti
  });
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true, secure: isProd, sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 giorni
    path: '/auth/refresh',
  });
}

// GET /auth/login
exports.getLogin = (req, res) => {
  if (res.locals.user) return res.redirect('/shop');
  res.render('auth/login', { error: null, email: '' });
};

// POST /auth/login
exports.postLogin = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.render('auth/login', { error: errors.array()[0].msg, email: req.body.email });
  }

  const { email: emailInput, password } = req.body;

  const user = await prisma.user.findUnique({
    where: { email: emailInput.toLowerCase() },
    include: { company: true },
  });

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.render('auth/login', { error: 'Email o password non corretti', email: emailInput });
  }

  if (!user.isEmailVerified) {
    return res.render('auth/login', { error: 'Verifica prima la tua email. Controlla la casella di posta.', email: emailInput });
  }

  const accessToken = generateAccessToken(user.id);
  const refreshToken = generateRefreshToken(user.id);

  await prisma.session.create({
    data: {
      userId: user.id,
      refreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  setTokenCookies(res, accessToken, refreshToken);

  if (user.role === 'ADMIN') return res.redirect('/admin');
  // Redirect a /shop/cart: lo script auto-merge fonde il carrello guest (localStorage) nel DB
  const redirect = req.query.redirect || '/shop/cart';
  return res.redirect(redirect);
};

// GET /auth/register
exports.getRegister = (req, res) => {
  if (res.locals.user) return res.redirect('/shop');
  res.render('auth/register', { error: null, values: {} });
};

// POST /auth/register
exports.postRegister = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.render('auth/register', { error: errors.array()[0].msg, values: req.body });
  }

  const { firstName, lastName, email: emailInput, password, phone,
          companyName, vatNumber, fiscalCode, sdiCode, pec, companyPhone, website } = req.body;

  const existingUser = await prisma.user.findUnique({ where: { email: emailInput.toLowerCase() } });
  if (existingUser) {
    return res.render('auth/register', { error: 'Esiste già un account con questa email', values: req.body });
  }

  const existingCompany = await prisma.company.findUnique({ where: { vatNumber } });
  if (existingCompany) {
    return res.render('auth/register', { error: 'Questa P.IVA è già registrata', values: req.body });
  }

  const verifyToken = crypto.randomBytes(32).toString('hex');
  const hashedPassword = await bcrypt.hash(password, 12);

  const company = await prisma.company.create({
    data: { name: companyName, vatNumber, fiscalCode, sdiCode, pec, phone: companyPhone, website },
  });

  const user = await prisma.user.create({
    data: {
      email: emailInput.toLowerCase(),
      password: hashedPassword,
      firstName, lastName, phone,
      companyId: company.id,
      emailVerifyToken: verifyToken,
    },
  });

  await email.sendWelcome({ ...user, emailVerifyToken: verifyToken });

  res.render('auth/register-success', { email: user.email });
};

// GET /auth/verify-email?token=...
exports.verifyEmail = async (req, res) => {
  const { token } = req.query;
  const user = await prisma.user.findFirst({ where: { emailVerifyToken: token } });

  if (!user) {
    return res.render('auth/verify-error');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { isEmailVerified: true, emailVerifyToken: null },
  });

  res.render('auth/verify-success');
};

// POST /auth/logout
exports.logout = async (req, res) => {
  const refreshToken = req.cookies?.refreshToken;
  if (refreshToken) {
    await prisma.session.deleteMany({ where: { refreshToken } }).catch(() => {});
  }
  res.clearCookie('accessToken');
  res.clearCookie('refreshToken', { path: '/auth/refresh' });
  res.redirect('/auth/login');
};

// POST /auth/refresh
exports.refresh = async (req, res) => {
  const token = req.cookies?.refreshToken;
  if (!token) return res.status(401).json({ error: 'Nessun refresh token' });

  try {
    const payload = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    const session = await prisma.session.findUnique({ where: { refreshToken: token } });

    if (!session || session.expiresAt < new Date()) {
      return res.status(401).json({ error: 'Sessione scaduta' });
    }

    const newAccessToken = generateAccessToken(payload.userId);
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie('accessToken', newAccessToken, {
      httpOnly: true, secure: isProd, sameSite: 'lax', maxAge: 15 * 60 * 1000,
    });
    res.json({ ok: true });
  } catch {
    res.status(401).json({ error: 'Refresh token non valido' });
  }
};

// GET /auth/forgot-password
exports.getForgot = (req, res) => res.render('auth/forgot-password', { sent: false, error: null });

// POST /auth/forgot-password
exports.postForgot = async (req, res) => {
  const { email: emailInput } = req.body;
  const user = await prisma.user.findUnique({ where: { email: emailInput.toLowerCase() } });

  // Risponde sempre con successo per non rivelare se l'email esiste
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 ora
    await prisma.user.update({
      where: { id: user.id },
      data: { resetPasswordToken: token, resetPasswordExpires: expires },
    });
    const resetUrl = `${process.env.BASE_URL}/auth/reset-password?token=${token}`;
    await email.sendPasswordReset(user, resetUrl).catch(() => {});
  }

  res.render('auth/forgot-password', { sent: true, error: null });
};

// GET /auth/reset-password?token=...
exports.getResetPassword = async (req, res) => {
  const { token } = req.query;
  const user = await prisma.user.findFirst({
    where: { resetPasswordToken: token, resetPasswordExpires: { gt: new Date() } },
  });
  if (!user) return res.render('auth/reset-error');
  res.render('auth/reset-password', { token, error: null });
};

// POST /auth/reset-password
exports.postResetPassword = async (req, res) => {
  const { token, password } = req.body;
  const user = await prisma.user.findFirst({
    where: { resetPasswordToken: token, resetPasswordExpires: { gt: new Date() } },
  });
  if (!user) return res.render('auth/reset-error');

  await prisma.user.update({
    where: { id: user.id },
    data: {
      password: await bcrypt.hash(password, 12),
      resetPasswordToken: null,
      resetPasswordExpires: null,
    },
  });

  // Invalida tutte le sessioni attive
  await prisma.session.deleteMany({ where: { userId: user.id } });

  res.redirect('/auth/login?reset=1');
};
