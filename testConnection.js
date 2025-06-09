// testConnection.js
const { Client } = require('pg');
require('./config/config')

const client = new Client({
  host: 'gigs-tech.cty6co862htp.eu-north-1.rds.amazonaws.com',
  port: 5432,
  user: 'shahen',
  password: process.env.PG_PASSWORD,
  database: 'gigs-tech',
  ssl: {
    rejectUnauthorized: false,
  },
});

client.connect()
  .then(() => {
    console.log('Connected to PostgreSQL');
    return client.end();
  })
  .catch(err => {
    console.error('Connection failed:', err.message);
  });
 