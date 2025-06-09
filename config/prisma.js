// config/prisma.js
const { PrismaClient } = require('@prisma/client');
const logger = require('./logger');

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'staging' ? ['query'] : [], // log SQL queries in staging
});

// Optionally handle Prisma query errors/events:
prisma.$on('error', (e) => {
  logger.error(`Prisma error: ${e.message}`);
});

module.exports = prisma;
