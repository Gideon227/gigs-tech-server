// middleware/apiErrorHandler.js
const logger = require('../config/logger');

module.exports = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  const requestId = req.requestId || 'N/A';

  logger.error(`[${requestId}] ${err.stack || err}`);

  // In production, hide stack traces
  if (process.env.NODE_ENV === 'production') {
    res.status(err.statusCode).json({
      status: err.status,
      message: err.message,
      requestId
    });
  } else {
    // In staging/dev, include stack trace
    res.status(err.statusCode).json({
      status: err.status,
      message: err.message,
      stack: err.stack,
      requestId
    });
  }

  logger.error(err.stack || err);
};
