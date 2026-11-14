const AppError = require('./AppError');

class NotFoundError extends AppError {
  constructor(resource = 'Resource', id = null) {
    const message = id ? `${resource} with id '${id}' not found` : `${resource} not found`;
    super(message, 404);
  }
}

module.exports = NotFoundError;

