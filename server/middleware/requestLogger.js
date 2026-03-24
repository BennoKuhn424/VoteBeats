/**
 * One-line JSON logs for load balancers / log aggregators (Render, Railway, etc.).
 * Skips noisy health checks.
 */
function requestLogger(req, res, next) {
  const pathOnly = (req.originalUrl || '').split('?')[0];
  if (pathOnly === '/health' || pathOnly === '/api/health') {
    return next();
  }

  const start = Date.now();
  res.on('finish', () => {
    try {
      const line = JSON.stringify({
        t: new Date().toISOString(),
        method: req.method,
        path: pathOnly,
        status: res.statusCode,
        ms: Date.now() - start,
      });
      console.log(line);
    } catch (_) {
      /* ignore */
    }
  });
  next();
}

module.exports = { requestLogger };
