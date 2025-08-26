const prisma = require('../config/prisma');
const APIFeatures = require('../utils/apiFeatures');
const redisClient = require('../config/redisClient');
const logger = require('../config/logger');
const Fuse = require('fuse.js');

const CANDIDATE_LIMIT = 2000;
const CANDIDATE_MULTIPLIER = 10;

/** Build a deterministic Redis key from a base and query object */
const buildCacheKey = (baseKey, queryObject) => {
  const sortedKeys = Object.keys(queryObject || {})
    .sort()
    .map((key) => `${key}:${queryObject[key]}`)
    .join('|');
  return `${baseKey}:${sortedKeys}`;
};

const invalidateJobsCache = async () => {
  try {
    const keys = await redisClient.smembers('jobs:keys');
    if (keys.length) {
      await redisClient.del(...keys);
      await redisClient.del('jobs:keys');
      logger.debug(`Redis cache invalidated keys: ${keys}`);
    }
  } catch (err) {
    logger.error(`Redis cache invalidation error: ${err.message}`);
  }
};

const deduplicateJobs = (jobs) => {
  const seen = new Set();
  return jobs.filter((job) => {
    const key = [
      job.title?.trim().toLowerCase(),
      job.description?.trim().toLowerCase(),
      (job.skills || []).slice().sort().join('|'),
      job.country?.trim().toLowerCase(),
      job.state?.trim().toLowerCase(),
      job.city?.trim().toLowerCase(),
      job.minSalary,
      job.maxSalary,
    ].join('::');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** Expire jobs updated > 36 hours ago */
exports.expireOldJobs = async () => {
  try {
    const cutoffTime = new Date(Date.now() - 36 * 60 * 60 * 1000);
    const result = await prisma.job.updateMany({
      where: {
        updatedAt: { lt: cutoffTime },
        jobStatus: { not: 'expired' },
      },
      data: { jobStatus: 'expired' },
    });
    if (result.count > 0) await invalidateJobsCache();
    logger.info(`Expired ${result.count} jobs older than 36 hours`);
  } catch (err) {
    logger.error(`Error expiring jobs: ${err.message}`);
  }
};

/** Get jobs (filters + pagination + fuzzy + dedupe + caching) */
exports.getAllJobs = async (reqQuery = {}) => {
  const cacheKey = buildCacheKey('jobs', reqQuery);

  // Try cache first
  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      logger.debug(`Redis cache hit: ${cacheKey}`);
      return JSON.parse(cached);
    }
  } catch (err) {
    logger.error(`Redis get error: ${err.message}`);
  }

  // Build where/order/select/pagination with APIFeatures
  const features = new APIFeatures(reqQuery);
  await features.filter();
  features.sort().limitFields().paginate();
  const options = features.build();

  const page = Number(options._page) || 1;
  const limit = Number(options._limit) || 10;

  // Non-fuzzy path: use Prisma pagination directly
  const fuzzyEnabled = !!(features.fuzzy && (features.fuzzy.keyword || features.fuzzy.location));

  let jobs = [];
  let totalJobs = 0;

  if (!fuzzyEnabled) {
    try {
      // count with EXACT same where
      totalJobs = await prisma.job.count({ where: options.where });

      // if skip exceeds total, return empty page
      const skip = options.skip || 0;
      if (skip >= totalJobs) {
        jobs = [];
      } else {
        jobs = await prisma.job.findMany({
          where: options.where,
          orderBy: options.orderBy || [{ postedDate: 'desc' }],
          select: options.select,
          skip: options.skip,
          take: options.take,
        });
      }
    } catch (err) {
      logger.error(`Prisma findMany/count error: ${err.message}`);
      throw err;
    }
  } else {
    // Fuzzy path: fetch a larger candidate set, dedupe, fuse, then paginate in-memory
    const candidateFetchLimit = Math.min(
      CANDIDATE_LIMIT,
      Math.max(100, limit * CANDIDATE_MULTIPLIER)
    );

    let candidates = [];
    try {
      candidates = await prisma.job.findMany({
        where: options.where,
        orderBy: options.orderBy || [{ postedDate: 'desc' }],
        select: options.select,
        take: candidateFetchLimit,
      });
    } catch (err) {
      logger.error(`Prisma candidate findMany error: ${err.message}`);
      throw err;
    }

    candidates = deduplicateJobs(candidates);

    // Build Fuse keys
    const fuseKeys = [];
    if (features.fuzzy.keyword) {
      fuseKeys.push({ name: 'title', weight: 0.6 });
      fuseKeys.push({ name: 'description', weight: 0.3 });
      fuseKeys.push({ name: 'companyName', weight: 0.1 });
    }
    if (features.fuzzy.location) {
      fuseKeys.push({ name: 'city', weight: 0.35 });
      fuseKeys.push({ name: 'state', weight: 0.25 });
      fuseKeys.push({ name: 'country', weight: 0.2 });
    }

    const searchTerms = [];
    if (features.fuzzy.keyword) searchTerms.push(features.fuzzy.keyword);
    if (features.fuzzy.location) searchTerms.push(features.fuzzy.location);
    const compositeSearch = searchTerms.join(' ').trim();

    const fuse = new Fuse(candidates, {
      keys: fuseKeys,
      threshold: 0.45,
      ignoreLocation: true,
      includeScore: true,
    });

    const fuseResults = compositeSearch
      ? fuse.search(compositeSearch)
      : candidates.map((c) => ({ item: c, score: 0 }));

    const scored = fuseResults.map((r) => ({
      item: r.item,
      score: typeof r.score === 'number' ? r.score : 0,
    }));

    // Sort by best score, break ties by createdAt desc
    scored.sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      const ta = new Date(a.item.createdAt || 0).getTime();
      const tb = new Date(b.item.createdAt || 0).getTime();
      return tb - ta;
    });

    totalJobs = scored.length;

    const start = (page - 1) * limit;
    const end = start + limit;
    jobs = scored.slice(start, end).map((x) => x.item);
  }

  // Cache
  const payload = { jobs, totalJobs, page, limit };
  try {
    await redisClient.set(cacheKey, JSON.stringify(payload), 'EX', 60);
    await redisClient.sadd('jobs:keys', cacheKey);
    logger.debug(`Redis cache set: ${cacheKey}`);
  } catch (err) {
    logger.error(`Redis set error: ${err.message}`);
  }

  return payload;
};

exports.getJobsLength = async () => {
  // Length of currently active jobs within default window
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  return prisma.job.count({
    where: { jobStatus: 'active', postedDate: { gte: thirtyDaysAgo } },
  });
};

exports.getJobById = async (jobId) => {
  return prisma.job.findUnique({ where: { id: jobId } });
};

exports.createJob = async (jobData) => {
  const job = await prisma.job.create({ data: jobData });
  await invalidateJobsCache();
  return job;
};

exports.updateJob = async (jobId, updateData) => {
  const job = await prisma.job.update({
    where: { id: jobId },
    data: updateData,
  });
  await invalidateJobsCache();
  return job;
};

exports.updateJobStatus = async (jobId, newStatus) => {
  const job = await prisma.job.update({
    where: { id: jobId },
    data: { jobStatus: newStatus },
  });
  await invalidateJobsCache();
  return job;
};

exports.deleteJob = async (jobId) => {
  const job = await prisma.job.delete({ where: { id: jobId } });
  await invalidateJobsCache();
  return job;
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

  const currentJob = await prisma.job.findUnique({ where: { id: jobId } });
  if (!currentJob) throw new Error('Job not found');

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const candidates = await prisma.job.findMany({
    where: {
      id: { not: jobId },
      roleCategory: currentJob.roleCategory,
      postedDate: { gte: thirtyDaysAgo },
      jobStatus: 'active',
    },
  });

  const related = candidates
    .map((job) => {
      let score = 3; // base for same roleCategory
      if (job.experienceLevel === currentJob.experienceLevel) score += 1;
      if (
        typeof job.country === 'string' &&
        typeof currentJob.country === 'string' &&
        job.country.toLowerCase() === currentJob.country.toLowerCase()
      ) {
        score += 0.5;
      }

      const sharedSkills =
        Array.isArray(job.skills) && Array.isArray(currentJob.skills)
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
    logger.debug(`Redis cache set: ${cacheKey}`);
  } catch (err) {
    logger.error(`Redis write error: ${err.message}`);
  }

  return related;
};
