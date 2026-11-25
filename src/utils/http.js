// Small HTTP helpers shared by controllers.

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function httpError(status, message) {
  return new HttpError(status, message);
}

/** Wraps an async route handler so rejected promises reach the error middleware. */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PASSWORD = 8;
const LANGUAGES = ['mixed', 'hi', 'en'];

function normalizeEmail(email = '') {
  return String(email).trim().toLowerCase();
}

module.exports = {
  HttpError,
  httpError,
  asyncHandler,
  EMAIL_PATTERN,
  MIN_PASSWORD,
  LANGUAGES,
  normalizeEmail,
};
