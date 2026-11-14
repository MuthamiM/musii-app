require('dotenv').config();

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT, 10) || 5050,
  APP_NAME: 'MUSII',
  VERSION: '1.9.1',
  IS_PRODUCTION: process.env.NODE_ENV === 'production',
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*'
};

module.exports = env;
