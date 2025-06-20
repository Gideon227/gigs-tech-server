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

const invalidateJobsCache = async () => {
  const keys = await redisClient.smembers('jobs:keys');
  if (keys.length) {
    await redisClient.del(...keys);
    await redisClient.del('jobs:keys');
    logger.debug(`Redis cache invalidated keys: ${keys}`);
  }
};


exports.getAllJobs = async (reqQuery) => {
  const cacheKey = buildCacheKey('jobs', reqQuery);

  // Try to fetch from Redis

  try {
    const cachedData = await redisClient.get(cacheKey);
    if (cachedData) {
      logger.debug(`Redis cache hit: ${cacheKey}`);
      return JSON.parse(cachedData);
    } 
  } catch (error) {
    logger.error(`Redis get error: ${error.message}`)
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

  try {
    // Cache result in Redis for 60 seconds
    await redisClient.set(cacheKey, JSON.stringify(jobs), 'EX', 60);
    // Track this cache key
    await redisClient.sadd('jobs:keys', cacheKey);
    logger.debug(`Redis cache set: ${cacheKey}`);
  } catch (error) {
    logger.error(`Redis set error: ${error.message}`)
  }

  return jobs;
};

exports.getJobsLength = async () => {
  const cacheKey = buildCacheKey('jobsLength', reqQuery);
  // Try to fetch from Redis

  try {
    const cachedData = await redisClient.get(cacheKey);
    if (cachedData) {
      logger.debug(`Redis cache hit: ${cacheKey}`);
      return JSON.parse(cachedData);
    } 
  } catch (error) {
    logger.error(`Redis get error: ${error.message}`)
  }

  const jobsLength = await prisma.job.count({
    where: {
      jobStatus: "ACTIVE"
    }
  })

  try {
    // Cache result in Redis for 60 seconds
    await redisClient.set(cacheKey, JSON.stringify(jobsLength), 'EX', 60);
    // Track this cache key
    await redisClient.sadd('jobsLength:keys', cacheKey);
    logger.debug(`Redis cache set: ${cacheKey}`);
  } catch (error) {
    logger.error(`Redis set error: ${error.message}`)
  }
}

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
  invalidateJobsCache()

  return updatedJob;
};

exports.updateJob = async (jobId, updateData) => {
  const updatedJob = await prisma.job.update({
    where: { id: jobId },
    data: updateData,
  });

  // Invalidate cache
  invalidateJobsCache()

  return updatedJob;
};

exports.deleteJob = async (jobId) => {
  const deletedJob = await prisma.job.delete({
    where: { id: jobId },
  });

  // Invalidate cache
  invalidateJobsCache()

  return deletedJob;
};
