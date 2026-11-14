const { ValidationError } = require('../errors');

/**
 * Request validation middleware helper
 */
function validate(schema) {
  return (req, res, next) => {
    const errors = [];

    if (schema.body) {
      for (const [field, rules] of Object.entries(schema.body)) {
        const val = req.body ? req.body[field] : undefined;
        if (rules.required && (val === undefined || val === null || val === '')) {
          errors.push(`Field '${field}' is required`);
        } else if (val !== undefined && rules.type && typeof val !== rules.type) {
          errors.push(`Field '${field}' must be of type ${rules.type}`);
        }
      }
    }

    if (schema.params) {
      for (const [param, rules] of Object.entries(schema.params)) {
        const val = req.params[param];
        if (rules.required && !val) {
          errors.push(`Param '${param}' is required`);
        }
      }
    }

    if (errors.length > 0) {
      return next(new ValidationError('Invalid request payload', errors));
    }

    next();
  };
}

module.exports = validate;

