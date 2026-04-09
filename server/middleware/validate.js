/**
 * Middleware factory — validates req.body against a Zod schema.
 * On success, replaces req.body with the parsed (coerced/trimmed) data.
 * On failure, responds 400 with the first validation error message.
 * @param {import('zod').ZodTypeAny} schema
 */
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const message = result.error.issues[0]?.message || 'Validation failed';
      return res.status(400).json({ error: message, code: 'VALIDATION_ERROR' });
    }
    req.body = result.data;
    next();
  };
}

module.exports = validate;
