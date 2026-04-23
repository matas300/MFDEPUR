const router = require('express').Router();
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const { requireAuth, requireApprovedCompany } = require('../middleware/auth');
const orderCtrl = require('../controllers/orderController');
const prisma = require('../config/database');
const { MAX_LEN } = require('../config/constants');
const { logAudit } = require('../utils/audit');

const deleteAccountLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 ora
  max: 3,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: 'Troppi tentativi di cancellazione. Riprova tra un\'ora.',
});

router.use(requireAuth);

// Dashboard account
router.get('/', (req, res) => res.render('account/dashboard', { title: 'Il mio account' }));

// Ordini
router.get('/orders', requireApprovedCompany, orderCtrl.getMyOrders);
router.get('/orders/:id', requireApprovedCompany, orderCtrl.getOrderDetail);

// Profilo
router.get('/profile', (req, res) => res.render('account/profile', { title: 'Profilo', success: req.query.success }));

router.post('/profile',
  [
    body('firstName').trim().notEmpty().isLength({ max: MAX_LEN.firstName })
      .withMessage(`Nome obbligatorio (max ${MAX_LEN.firstName} caratteri)`),
    body('lastName').trim().notEmpty().isLength({ max: MAX_LEN.lastName })
      .withMessage(`Cognome obbligatorio (max ${MAX_LEN.lastName} caratteri)`),
    body('phone').optional({ checkFalsy: true }).trim().isLength({ max: MAX_LEN.phone })
      .withMessage(`Telefono troppo lungo (max ${MAX_LEN.phone} caratteri)`),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).render('account/profile', {
        title: 'Profilo',
        errors: errors.array().map(e => e.msg),
      });
    }
    const { firstName, lastName, phone } = req.body;
    await prisma.user.update({
      where: { id: req.user.id },
      data: {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone?.trim() || null,
      },
    });
    res.redirect('/account/profile?success=1');
  }
);

// Indirizzi
router.get('/addresses', async (req, res) => {
  const addresses = await prisma.address.findMany({
    where: { companyId: req.user.companyId },
    orderBy: { isDefault: 'desc' },
  });
  res.render('account/addresses', { addresses, title: 'Indirizzi di spedizione' });
});

router.post('/addresses', async (req, res) => {
  const { label, street, city, province, postalCode, country, isDefault } = req.body;
  if (isDefault) {
    await prisma.address.updateMany({
      where: { companyId: req.user.companyId },
      data: { isDefault: false },
    });
  }
  await prisma.address.create({
    data: {
      companyId: req.user.companyId,
      label, street, city, province, postalCode,
      country: country || 'IT',
      isDefault: isDefault === 'on',
    },
  });
  res.redirect('/account/addresses?success=1');
});

router.post('/addresses/:id/delete', async (req, res) => {
  await prisma.address.deleteMany({
    where: { id: req.params.id, companyId: req.user.companyId },
  });
  res.redirect('/account/addresses');
});

// ── GDPR: pagina privacy account ──────────────────────────────────────────────
router.get('/privacy', (req, res) => {
  res.render('account/privacy', { title: 'I miei dati (GDPR)' });
});

// ── GDPR: export dati personali (Art. 15 / 20 GDPR) ───────────────────────────
// Restituisce un JSON scaricabile con tutti i dati personali dell'utente.
router.get('/export', async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    include: {
      company: { include: { addresses: true } },
      orders: { include: { items: true, address: true } },
      sessions: { select: { id: true, expiresAt: true, createdAt: true } },
    },
  });
  if (!user) return res.status(404).render('error', { message: 'Utente non trovato', code: 404 });

  const payload = {
    exportedAt: new Date().toISOString(),
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      role: user.role,
      isEmailVerified: user.isEmailVerified,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    },
    company: user.company,
    orders: user.orders,
    sessions: user.sessions,
  };

  logAudit(req, { action: 'GDPR_EXPORT', entityType: 'User', entityId: user.id });

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="mfdepur-export-${user.email}-${stamp}.json"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(JSON.stringify(payload, null, 2));
});

// ── GDPR: cancellazione account (Art. 17 — diritto all'oblio) ─────────────────
// Soft delete: anonimizza utente conservando ordini per obblighi fiscali (10 anni
// per le fatture, art. 2220 c.c.). Email/nome/telefono sostituiti con marker.
router.post('/delete', deleteAccountLimiter, async (req, res) => {
  const { confirm } = req.body;
  if (confirm !== 'ELIMINA') {
    return res.render('account/privacy', {
      title: 'I miei dati (GDPR)',
      error: 'Per confermare la cancellazione devi digitare esattamente ELIMINA.',
    });
  }

  // Admin non può autocancellarsi (rischio di lock-out)
  if (req.user.role === 'ADMIN') {
    return res.render('account/privacy', {
      title: 'I miei dati (GDPR)',
      error: 'Gli account ADMIN non possono essere cancellati da questa pagina.',
    });
  }

  const userId = req.user.id;
  const originalEmail = req.user.email;
  // Email univoca → usa hash del vecchio id per non collidere
  const tag = crypto.randomBytes(6).toString('hex');
  const anonEmail = `deleted-${tag}@anonymized.local`;

  await prisma.$transaction([
    prisma.session.deleteMany({ where: { userId } }),
    prisma.user.update({
      where: { id: userId },
      data: {
        email: anonEmail,
        password: crypto.randomBytes(32).toString('hex'), // hash invalido — login impossibile
        firstName: 'Utente',
        lastName: 'Cancellato',
        phone: null,
        emailVerifyToken: null,
        resetPasswordToken: null,
        resetPasswordExpires: null,
        isEmailVerified: false,
      },
    }),
  ]);

  logAudit(req, {
    action: 'GDPR_DELETE',
    entityType: 'User',
    entityId: userId,
    metadata: { originalEmail, anonEmail },
  });

  // Logout: pulisce cookie e redirect
  res.clearCookie('accessToken', { path: '/' });
  res.clearCookie('refreshToken', { path: '/auth/refresh' });
  res.redirect('/?deleted=1');
});

module.exports = router;
