// config/redisClient.js
const Redis = require('ioredis');
const logger = require('./logger');
const { redis, env } = require('./config');

const redisClient = new Redis({
  host: redis.host,
  port: redis.port,
  password: redis.password, 
  tls: {}
});

redisClient.on('connect', () => {
  logger.info('Redis client connected');
});

redisClient.on('error', (err) => {
  logger.error(`Redis error: ${err}`);
});

module.exports = redisClient;
