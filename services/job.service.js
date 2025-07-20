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

  const jobs = await prisma.job.findMany(options);
  const totalJobs = await prisma.job.count({ where: options.where });

  const payloadToCache = { jobs, totalJobs };

  try {
    await redisClient.set(cacheKey, JSON.stringify(payloadToCache), 'EX', 60);
    await redisClient.sadd('jobs:keys', cacheKey);
    logger.debug(`Redis cache set: ${cacheKey}`);
  } catch (error) {
    logger.error(`Redis set error: ${error.message}`)
  }

  return {jobs, totalJobs};
};

exports.getJobsLength = async () => {
  const total = await prisma.job.count({
    where: { jobStatus: "active" }, 
  });
  return total;
}

exports.getJobById = async (jobId) => {
  const isValidUUID = (str) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(str);

  if (!isValidUUID(jobId)) {
    throw new Error(`Invalid UUID: ${jobId}`);
  }

  try {
    return await prisma.job.findUnique({ where: { id: jobId } });
  } catch (err) {
    console.error('Invalid UUID passed to findUnique:', jobId, err.message);
    throw new Error('Invalid job ID');
  }
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

exports.getRelatedJobs = async (jobId) => {
  const cacheKey = `related-jobs:${jobId}`;

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      logger.debug(`Redis cache hit: ${cacheKey}`);
      return JSON.parse(cached);
    }
  } catch (err) {
    logger.error(`Redis read error: ${err.message}`);
  }

  const currentJob = await prisma.job.findUnique({
    where: { id: jobId }
  });

  if (!currentJob) {
    throw new Error('Job not found');
  }

  const candidates = await prisma.job.findMany({
    where: {
      id: { not: jobId },
      roleCategory: currentJob.roleCategory
    }
  });

  const related = candidates
    .map((job) => {
      let score = 0;

      score += 3;

      if (job.experienceLevel === currentJob.experienceLevel) {
        score += 1;
      }

      if (
        typeof job.country === 'string' &&
        typeof currentJob.country === 'string' &&
        job.country.toLowerCase() === currentJob.country.toLowerCase()
      ) {
        score += 0.5;
      }

      const sharedSkills = Array.isArray(job.skills) && Array.isArray(currentJob.skills)
      ? job.skills.filter((skill) =>
          currentJob.skills.some(
            (s) =>
              typeof s === 'string' &&
              typeof skill === 'string' &&
              s.toLowerCase() === skill.toLowerCase()
          )
        )
      : [];

      if (sharedSkills.length > 0) score += 2;

      return { ...job, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3); 
    
  try {
    await redisClient.set(cacheKey, JSON.stringify(related), 'EX', 300);
    await redisClient.sadd('related-jobs:keys', cacheKey);
  } catch (err) {
    logger.error(`Redis write error: ${err.message}`);
  }

  return related;
}
