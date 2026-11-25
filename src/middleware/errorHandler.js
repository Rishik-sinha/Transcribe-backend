// Global error handler — keep last in the middleware chain.
// eslint-disable-next-line no-unused-vars
module.exports = function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  if (status >= 500) {
    console.error('❌ Error:', err.stack || err.message);
  }
  res.status(status).json({
    error: status >= 500 ? 'Internal Server Error' : err.message,
  });
};
