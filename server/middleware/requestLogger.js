const crypto = require('crypto');

/**
 * Express middleware — emits one structured JSON log line per request on finish.
 * Skips `/health` and `/api/health` to avoid log noise from uptime monitors.
 * Assigns a unique request ID (req.id) for tracing through downstream logs.
 * Log format: { t, rid, method, path, status, ms }
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function requestLogger(req, res, next) {
  const pathOnly = (req.originalUrl || '').split('?')[0];
  if (pathOnly === '/health' || pathOnly === '/api/health') {
    return next();
  }

  req.id = crypto.randomBytes(6).toString('hex');
  const start = Date.now();
  res.on('finish', () => {
    try {
      const line = JSON.stringify({
        t: new Date().toISOString(),
        rid: req.id,
        method: req.method,
        path: pathOnly,
        status: res.statusCode,
        ms: Date.now() - start,
      });
      console.log(line);
    } catch (err) {
      console.error('Request logger error:', err);
    }
  });
  next();
}

module.exports = { requestLogger };
