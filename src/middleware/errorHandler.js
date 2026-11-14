const { AppError } = require('../errors');
const env = require('../config/env');

/**
 * Centralized Global Error Handling Middleware
 */
function errorHandler(err, req, res, next) {
  let error = err;

  // If not an operational AppError, wrap it
  if (!(error instanceof AppError)) {
    const statusCode = error.statusCode || error.status || 500;
    const message = error.message || 'Internal Server Error';
    error = new AppError(message, statusCode);
  }

  // Development logging
  if (!env.IS_PRODUCTION) {
    console.error(`[Error Handler] ${error.name} (${error.statusCode}): ${error.message}`);
    if (error.stack) console.error(error.stack);
  }

  res.status(error.statusCode).json({
    status: error.status,
    name: error.name,
    message: error.message,
    details: error.details,
    timestamp: error.timestamp || new Date().toISOString(),
    ...(env.IS_PRODUCTION ? {} : { stack: error.stack })
  });
}

module.exports = errorHandler;

