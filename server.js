// server.js
require('./config/config')
const http = require('http');
const app = require('./app');
const prisma = require('./config/prisma');
const logger = require('./config/logger');
const { port, env } = require('./config/config');

const startServer = async () => {
  try {
    // 1) Test Prisma connection
    await prisma.$connect();
    logger.info('Prisma connected to PostgreSQL successfully');
  } catch (err) {
    logger.error(`Prisma connection error: ${err.message}`);
    process.exit(1);
  }

  // Start HTTP Server
  const server = http.createServer(app);

  server.listen(port, "0.0.0.0", () => {
    logger.info(`Server running in ${env} mode on port ${port}...`);
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (err) => {
    logger.error(`UNHANDLED REJECTION: ${err.message}`);
    server.close(() => process.exit(1));
  });

  // 4) Handle uncaught exceptions
  process.on('uncaughtException', (err) => {
    logger.error(`UNCAUGHT EXCEPTION: ${err.message}`);
    process.exit(1);
  });
};

startServer();