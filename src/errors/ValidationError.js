const AppError = require('./AppError');

class ValidationError extends AppError {
  constructor(message = 'Validation failed', errors = []) {
    super(message, 400, errors);
  }
}

module.exports = ValidationError;

