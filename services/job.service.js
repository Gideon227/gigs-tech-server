// services/job.service.js
const prisma = require('../config/prisma');
const APIFeatures = require('../utils/apiFeatures');
const redisClient = require('../config/redisClient');
const logger = require('../config/logger');

/**
 * Build a deterministic Redis key from a base string and query object.
 * e.g. baseKey = 'jobs', queryObject = { page: '2', status: 'open' }
 * → 'jobs:page:2|status:open'
 */
const buildCacheKey = (baseKey, queryObject) => {
  const sortedKeys = Object.keys(queryObject)
    .sort()
    .map((key) => `${key}:${queryObject[key]}`)
    .join('|');
  return `${baseKey}:${sortedKeys}`;
};

exports.getAllJobs = async (reqQuery) => {
  const cacheKey = buildCacheKey('jobs', reqQuery);

  // Try to fetch from Redis
  const cachedData = await redisClient.get(cacheKey);
  if (cachedData) {
    logger.debug(`Redis cache hit: ${cacheKey}`);
    return JSON.parse(cachedData);
  }

  // Build Prisma query options
  const features = new APIFeatures(reqQuery)
    .filter()
    .sort()
    .limitFields()
    .paginate();
  const options = features.build();

  // Query PostgreSQL via Prisma
  const jobs = await prisma.job.findMany(options);

  // Cache result in Redis for 60 seconds
  await redisClient.set(cacheKey, JSON.stringify(jobs), 'EX', 60);
  logger.debug(`Redis cache set: ${cacheKey}`);

  return jobs;
};

exports.getJobById = async (jobId) => {
  return await prisma.job.findUnique({
    where: { id: jobId },
  });
};


exports.updateJobStatus = async (jobId, newStatus) => {
  const updatedJob = await prisma.job.update({
    where: { id: jobId },
    data: { status: newStatus },
  });

  // Invalidate cache
  const keys = await redisClient.keys('jobs:*');
  if (keys.length > 0) {
    await redisClient.del(keys);
    logger.debug(`Redis cache invalidated keys: ${keys}`);
  }

  return updatedJob;
};

exports.updateJob = async (jobId, updateData) => {
  const updatedJob = await prisma.job.update({
    where: { id: jobId },
    data: updateData,
  });

  // Invalidate cache
  const keys = await redisClient.keys('jobs:*');
  if (keys.length > 0) {
    await redisClient.del(keys);
    logger.debug(`Redis cache invalidated keys: ${keys}`);
  }

  return updatedJob;
};

exports.deleteJob = async (jobId) => {
  const deletedJob = await prisma.job.delete({
    where: { id: jobId },
  });

  // Invalidate cache
  const keys = await redisClient.keys('jobs:*');
  if (keys.length > 0) {
    await redisClient.del(keys);
    logger.debug(`Redis cache invalidated keys: ${keys}`);
  }

  return deletedJob;
};
