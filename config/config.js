// config/config.js
const path = require('path');
const dotenv = require('dotenv');

// Determine which .env file to load
const envFile =
  process.env.NODE_ENV === 'production' ? '.env.production' : '.env.staging';

dotenv.config({ path: path.resolve(process.cwd(), envFile) });

module.exports = {
  env: process.env.NODE_ENV,
  port: process.env.PORT || 4000,
  databaseUrl: process.env.DATABASE_URL,
  redis: {
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
  },
};
