const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/authController');

const loginRules = [
  body('email').isEmail().withMessage('Email non valida').normalizeEmail(),
  body('password').notEmpty().withMessage('Password obbligatoria'),
];

const registerRules = [
  body('firstName').trim().notEmpty().withMessage('Nome obbligatorio'),
  body('lastName').trim().notEmpty().withMessage('Cognome obbligatorio'),
  body('email').isEmail().withMessage('Email non valida').normalizeEmail(),
  body('password').isLength({ min: 8 }).withMessage('La password deve essere di almeno 8 caratteri'),
  body('companyName').trim().notEmpty().withMessage('Ragione sociale obbligatoria'),
  body('vatNumber').trim().notEmpty().withMessage('P.IVA obbligatoria')
    .matches(/^IT[0-9]{11}$|^[0-9]{11}$/).withMessage('P.IVA non valida (es. 01234567890 o IT01234567890)'),
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
router.post('/reset-password', ctrl.postResetPassword);

module.exports = router;
