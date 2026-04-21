const router = require('express').Router();
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const ctrl = require('../controllers/authController');

const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: 'Troppi tentativi di reset. Riprova tra un\'ora.',
});

// Password policy: min 10 caratteri, almeno 1 maiuscola, 1 minuscola, 1 numero
const strongPassword = body('password')
  .isLength({ min: 10 }).withMessage('La password deve essere di almeno 10 caratteri')
  .matches(/[a-z]/).withMessage('La password deve contenere almeno una lettera minuscola')
  .matches(/[A-Z]/).withMessage('La password deve contenere almeno una lettera maiuscola')
  .matches(/[0-9]/).withMessage('La password deve contenere almeno un numero');

const loginRules = [
  body('email').isEmail().withMessage('Email non valida').normalizeEmail(),
  body('password').notEmpty().withMessage('Password obbligatoria'),
];

const registerRules = [
  body('firstName').trim().notEmpty().withMessage('Nome obbligatorio'),
  body('lastName').trim().notEmpty().withMessage('Cognome obbligatorio'),
  body('email').isEmail().withMessage('Email non valida').normalizeEmail(),
  strongPassword,
  body('companyName').trim().notEmpty().withMessage('Ragione sociale obbligatoria'),
  body('vatNumber').trim().notEmpty().withMessage('P.IVA obbligatoria')
    .matches(/^IT[0-9]{11}$|^[0-9]{11}$/).withMessage('P.IVA non valida (es. 01234567890 o IT01234567890)'),
];

const resetPasswordRules = [
  body('token').notEmpty().withMessage('Token mancante'),
  strongPassword,
];

router.get('/login', ctrl.getLogin);
router.post('/login', loginRules, ctrl.postLogin);

router.get('/register', ctrl.getRegister);
router.post('/register', registerRules, ctrl.postRegister);

router.get('/verify-email', ctrl.verifyEmail);

router.post('/logout', ctrl.logout);
router.post('/refresh', ctrl.refresh);

router.get('/forgot-password', ctrl.getForgot);
router.post('/forgot-password', ctrl.postForgot);

router.get('/reset-password', ctrl.getResetPassword);
router.post('/reset-password', resetLimiter, resetPasswordRules, ctrl.postResetPassword);

module.exports = router;
