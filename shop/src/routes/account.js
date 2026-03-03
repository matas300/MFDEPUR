const router = require('express').Router();
const { requireAuth, requireApprovedCompany } = require('../middleware/auth');
const orderCtrl = require('../controllers/orderController');
const prisma = require('../config/database');

router.use(requireAuth);

// Dashboard account
router.get('/', (req, res) => res.render('account/dashboard', { title: 'Il mio account' }));

// Ordini
router.get('/orders', requireApprovedCompany, orderCtrl.getMyOrders);
router.get('/orders/:id', requireApprovedCompany, orderCtrl.getOrderDetail);

// Profilo
router.get('/profile', (req, res) => res.render('account/profile', { title: 'Profilo', success: req.query.success }));

router.post('/profile', async (req, res) => {
  const { firstName, lastName, phone } = req.body;
  await prisma.user.update({
    where: { id: req.user.id },
    data: { firstName: firstName.trim(), lastName: lastName.trim(), phone: phone?.trim() || null },
  });
  res.redirect('/account/profile?success=1');
});

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

module.exports = router;
