require('dotenv').config();

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT, 10) || 5050,
  APP_NAME: 'MUSII',
  VERSION: '1.9.8',
  IS_PRODUCTION: process.env.NODE_ENV === 'production',
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
  RESEND_API_KEY: process.env.RESEND_API_KEY || '',
  EMAIL_FROM: process.env.EMAIL_FROM || 'MUSII <noreply@mftechnologies.org>'
};

module.exports = env;
