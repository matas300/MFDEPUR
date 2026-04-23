// src/utils/asyncHandler.js
// Wrappa un handler async per Express 4: promise rejection diventa next(err)
// passato all'error handler centrale in app.js, invece di hang della request.

module.exports = function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
