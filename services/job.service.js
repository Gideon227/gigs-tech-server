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

  try {
    await redisClient.set(cacheKey, JSON.stringify(jobs), 'EX', 60);
    await redisClient.sadd('jobs:keys', cacheKey);
    logger.debug(`Redis cache set: ${cacheKey}`);
  } catch (error) {
    logger.error(`Redis set error: ${error.message}`)
  }

  return jobs;
};

exports.getJobsLength = async () => {
  const cacheKey = buildCacheKey('jobsLength', reqQuery);

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
    where: { id: jobId },
    include: { skills: true },
  });

  if (!currentJob) {
    throw new Error('Job not found');
  }

  const candidates = await prisma.job.findMany({
    where: {
      id: { not: jobId },
      roleCategory: currentJob.roleCategory
    },
    include: { skills: true },
  });

  const related = candidates
    .map((job) => {
      let score = 0;

      score += 3;

      // experienceLevel match
      if (job.experienceLevel === currentJob.experienceLevel) {
        score += 1;
      }

      // country match
      if (job.country && currentJob.country && job.country.toLowerCase() === currentJob.country.toLowerCase()) {
        score += 0.5;
      }

      // shared skills
      const sharedSkills = job.skills.filter((skill) =>
        currentJob.skills.some((s) => s.name.toLowerCase() === skill.name.toLowerCase())
      );
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
