/**
 * Centralized 404 + error handling for the JSON API.
 *
 * Without these, anything that isn't an explicit route response falls through to
 * Express's built-in handlers, which return an HTML page — inconsistent for an
 * API client and, in non-production, leaks a stack trace. These two middlewares
 * guarantee every response is JSON with a stable { error, code } shape and never
 * exposes internals.
 *
 * Wiring order in app.js: ...routes → notFound → Sentry error handler → errorHandler.
 */

/** Terminal 404 for any request that matched no route. */
function notFound(req, res) {
  res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
}

/**
 * Final error-handling middleware (4-arg signature is required for Express to
 * treat it as an error handler). Maps the handful of framework-level errors we
 * actually see to clean status codes, and collapses everything else to a 500
 * that never ships a stack trace to the client.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // If a route already started streaming the response, we can't change the
  // status/headers — hand off to Express's default so the socket still closes.
  if (res.headersSent) return next(err);

  // Origin rejected by the CORS allowlist (see app.js cors origin callback).
  if (err && err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'Origin not allowed', code: 'CORS_FORBIDDEN' });
  }

  // Malformed JSON body — body-parser throws a SyntaxError tagged like this.
  if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
    return res.status(400).json({ error: 'Malformed JSON body', code: 'INVALID_JSON' });
  }

  // Body exceeded express.json({ limit }).
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(413).json({ error: 'Request body too large', code: 'PAYLOAD_TOO_LARGE' });
  }

  // Honour an explicit client-error status a route may have attached; otherwise
  // treat it as an unexpected server fault.
  const status =
    err && Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;

  if (status >= 500) {
    // Server faults are worth a log line (Sentry, if configured, has already
    // captured the error by the time this runs).
    console.error(`[error] ${req.method} ${req.originalUrl}:`, err && (err.stack || err.message || err));
  }

  res.status(status).json({
    // Don't echo internal messages on 5xx — only safe, explicit client errors.
    error: status >= 500 ? 'Internal server error' : err?.message || 'Request failed',
    code: err?.code || (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED'),
  });
}

module.exports = { notFound, errorHandler };
