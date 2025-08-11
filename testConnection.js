// testConnection.js
const { Client } = require('pg');
require('./config/config')

const client = new Client({
  user: 'shahen',
  host: 'gigs-tech-prod-rds.cbiiywio2rr0.us-east-2.rds.amazonaws.com',
  database: 'gigs-tech',
  password: 'Zebra8!Moon$',
  port: 5432,
  ssl: {
    rejectUnauthorized: false,
  },
  connectionTimeoutMillis: 200000
});

client.connect()
  .then(() => {
    console.log('Connected to PostgreSQL');
    return client.end();
  })
  .catch(err => {
    console.error('Connection failed:', err.message);
  });
 