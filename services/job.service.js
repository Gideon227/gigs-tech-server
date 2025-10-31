const prisma = require('../config/prisma');
const APIFeatures = require('../utils/apiFeatures');
const redisClient = require('../config/redisClient');
const logger = require('../config/logger');
const Fuse = require('fuse.js');

const CANDIDATE_LIMIT = 2000; // max rows to fetch for fuzzy processing
const CANDIDATE_MULTIPLIER = 10;

const thirtyDaysAgo = new Date();
thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

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
  try {
    const keys = await redisClient.smembers('jobs:keys');
    if (keys.length) {
      await Promise.all([
        redisClient.del(...keys),
        redisClient.del('jobs:keys'),
      ]);
      logger.debug(`Redis cache invalidated keys: ${keys}`);
    }
  } catch (err) {
    logger.error(`Error invalidating Redis cache: ${err.message}`);
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

exports.getAllJobs = async (reqQuery = {}) => {
  const cacheKey = buildCacheKey('jobs', reqQuery);

  // Try cache first
  try {
    const cachedData = await redisClient.get(cacheKey);
    if (cachedData) {
      logger.debug(`Redis cache hit: ${cacheKey}`);
      return JSON.parse(cachedData);
    }
  } catch (err) {
    logger.error(`Redis get error: ${err.message}`);
  }

  const features = new APIFeatures(reqQuery);
  await features.filter();
  features.sort().limitFields().paginate();
  const options = features.build();

  const pageLimit = (options._limit && Number(options._limit)) || 10;
  const candidateFetchLimit = Math.min(
    CANDIDATE_LIMIT,
    Math.max(100, pageLimit * CANDIDATE_MULTIPLIER)
  );

  const candidateQuery = {
    where: options.where || {},
    take: candidateFetchLimit,
    select: options.select || undefined,
    orderBy: options.orderBy || undefined,
  };

  let candidates = [];
  try {
    candidates = await prisma.job.findMany(candidateQuery);
  } catch (err) {
    logger.error(`Prisma findMany error: ${err.message}`);
    throw err;
  }

  const fuzzyEnabled = !!(features.fuzzy && (features.fuzzy.keyword || features.fuzzy.location));

  let jobs = [];
  let totalJobs = 0;

  // 🧠 NON-FUZZY SEARCH
  if (!fuzzyEnabled) {
    try {
      const baseWhere = {
        ...options.where,
        postedDate: { gte: thirtyDaysAgo },
        jobStatus: { equals: "active" },
        AND: [
          {
            title: { notIn: [null, ""] },
            description: { notIn: [null, ""] },
          },
        ],
      };

      jobs = await prisma.job.findMany({
        where: baseWhere,
        orderBy: options.orderBy || [{ postedDate: "desc" }],
        select: options.select,
        skip: options.skip,
        take: options.take,
      });

      totalJobs = await prisma.job.count({ where: baseWhere });
    } catch (err) {
      logger.error(`Prisma findMany/count error: ${err.message}`);
      throw err;
    }
  } 
  // 🧠 FUZZY SEARCH
  else {
    try {
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

      candidates = candidates.filter(job =>
        new Date(job.postedDate) >= thirtyDaysAgo &&
        job.jobStatus === 'active' &&
        job.title &&
        job.description &&
        job.title.trim() !== '' &&
        job.description.trim() !== ''
      );

      if (!candidates.length) {
        jobs = [];
        totalJobs = 0;
      } else {
        const fuse = new Fuse(candidates, {
          keys: fuseKeys,
          threshold: 0.45,
          ignoreLocation: true,
          includeScore: true,
        });

        const searchTerms = [];
        if (features.fuzzy.keyword) searchTerms.push(features.fuzzy.keyword);
        if (features.fuzzy.location) searchTerms.push(features.fuzzy.location);
        const compositeSearch = searchTerms.join(' ').trim();

        const fuseResults = compositeSearch
          ? fuse.search(compositeSearch)
          : candidates.map(c => ({ item: c, score: 0 }));

        const scored = fuseResults.map(r => ({
          item: r.item,
          score: typeof r.score === 'number' ? r.score : 0
        }));

        scored.sort((a, b) => {
          const wantsRelevancySort = options.orderBy &&
            options.orderBy.some(order => Object.keys(order).includes('id'));

          if (wantsRelevancySort && a.score !== b.score) {
            return a.score - b.score;
          }

          if (options.orderBy && options.orderBy.length > 0) {
            for (const sortRule of options.orderBy) {
              const field = Object.keys(sortRule)[0];
              const direction = sortRule[field];
              if (field === 'id') continue;

              let aVal = a.item[field];
              let bVal = b.item[field];

              if (field === 'postedDate' || field === 'createdAt') {
                aVal = new Date(aVal || 0).getTime();
                bVal = new Date(bVal || 0).getTime();
              }

              if (typeof aVal === 'number' && typeof bVal === 'number') {
                if (aVal !== bVal) return direction === 'desc' ? bVal - aVal : aVal - bVal;
              }

              if (typeof aVal === 'string' && typeof bVal === 'string') {
                if (aVal !== bVal) return direction === 'desc' ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal);
              }
            }
          }

          return new Date(b.item.postedDate).getTime() - new Date(a.item.postedDate).getTime();
        });

        const page = Math.floor((options.skip || 0) / (options.take || 10)) + 1;
        const limit = options.take || 10;
        totalJobs = scored.length;

        const start = (page - 1) * limit;
        const end = start + limit;

        jobs = scored.slice(start, end).map(x => x.item);
      }
    } catch (err) {
      logger.error(`Fuzzy search error: ${err.message}`);
      throw err;
    }
  }

  // Cache final payload
  const payloadToCache = { jobs, totalJobs };
  try {
    await redisClient.set(cacheKey, JSON.stringify(payloadToCache), 'EX', 60);
    await redisClient.sadd('jobs:keys', cacheKey);
    logger.debug(`Redis cache set: ${cacheKey}`);
  } catch (err) {
    logger.error(`Redis set error: ${err.message}`);
  }

  return { jobs, totalJobs };
};

exports.getJobsLength = async () => {
  try {
    const total = await prisma.job.count({
      where: { jobStatus: "active" },
    });
    return total;
  } catch (err) {
    logger.error(`Error counting jobs: ${err.message}`);
    throw err;
  }
};

exports.getJobById = async (jobId) => {
  const isValidUUID = (str) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(str);

  if (!isValidUUID(jobId)) {
    throw new Error(`Invalid UUID: ${jobId}`);
  }

  try {
    return await prisma.job.findUnique({ where: { id: jobId } });
  } catch (err) {
    logger.error(`findUnique error: ${err.message}`);
    throw new Error('Invalid job ID');
  }
};

exports.updateJobStatus = async (jobId, newStatus) => {
  const updatedJob = await prisma.job.update({
    where: { id: jobId },
    data: { jobStatus: newStatus },
  });

  await invalidateJobsCache();
  return updatedJob;
};

exports.updateJob = async (jobId, updateData) => {
  const updatedJob = await prisma.job.update({
    where: { id: jobId },
    data: updateData,
  });

  await invalidateJobsCache();
  return updatedJob;
};

exports.deleteJob = async (jobId) => {
  const deletedJob = await prisma.job.delete({
    where: { id: jobId },
  });

  await invalidateJobsCache();
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

  if (!currentJob) throw new Error('Job not found');

  const candidates = await prisma.job.findMany({
    where: {
      id: { not: jobId },
      roleCategory: currentJob.roleCategory,
      postedDate: { gte: thirtyDaysAgo },
    },
  });

  const related = candidates
    .map((job) => {
      let score = 3;

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
  } catch (err) {
    logger.error(`Redis write error: ${err.message}`);
  }

  return related;
};
