const AppError = require('./AppError');

class AudioEngineError extends AppError {
  constructor(message = 'Audio synthesis pipeline failure', codec = 'WebAudio') {
    super(message, 502, { codec });
  }
}

module.exports = AudioEngineError;

