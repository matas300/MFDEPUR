const crypto = require('crypto');

// Genera un nonce base64 per request e lo espone in res.locals.cspNonce
// per l'uso in CSP (helmet) e nei template EJS (<script nonce="<%= cspNonce %>">).
module.exports = function cspNonce(req, res, next) {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
};
