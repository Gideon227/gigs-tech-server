const prisma = require('../config/prisma');
const APIFeatures = require('../utils/apiFeatures');
const redisClient = require('../config/redisClient');
const logger = require('../config/logger');
const Fuse = require ('fuse.js')

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
  const keys = await redisClient.smembers('jobs:keys');
  if (keys.length) {
    await redisClient.del(...keys);
    await redisClient.del('jobs:keys');
    logger.debug(`Redis cache invalidated keys: ${keys}`);
  }
};

// const deduplicateJobs = (jobs) => {
//   const seen = new Set();
//   return jobs.filter((job) => {
//     const key = [
//       job.title?.trim().toLowerCase(),
//       job.description?.trim().toLowerCase(),
//       (job.skills || []).slice().sort().join('|'),
//       job.country?.trim().toLowerCase(),
//       job.state?.trim().toLowerCase(),
//       job.city?.trim().toLowerCase(),
//       job.minSalary,
//       job.maxSalary,
//     ].join('::');
//     if (seen.has(key)) return false;
//     seen.add(key);
//     return true;
//   });
// };

/**
 * Excluded keywords for Microsoft Dynamics/Power Platform related jobs
 * These keywords will be matched case-insensitively against title, description, and skills
 */
const REQUIRED_KEYWORDS = [
  // Power Platform
  'dynamics 365',
  'power platform',
  'copilot ai',
  'power apps',
  'power automate',
  'power bi',
  'power virtual agents',
  'power fx',
  'power pages',
  'dataverse',
  'canvas app',
  'model-driven app',
  'power platform developer',
  'power platform consultant',
  'power platform architect',
  'power platform engineer',
  'power platform administrator',
  'power platform support',
  'power platform specialist',
  'power platform solution',
  
  // Dynamics variants
  'dynamics crm',
  'dynamics ax',
  'dynamics nav',
  'dynamics gp',
  'business central',
  'd365 f&o',
  'd365fo',
  'd365 finance',
  'd365 sales',
  'd365 customer service',
  'd365 field service',
  'd365 marketing',
  'd365 project operations',
  'd365 hr',
  'd365 talent',
  'dynamics developer',
  'dynamics consultant',
  'dynamics architect',
  'dynamics administrator',
  'dynamics functional consultant',
  'dynamics technical consultant',
  'dynamics support',
  'dynamics solution architect',
  
  // Copilot variants
  'microsoft copilot',
  'copilot for power platform',
  'copilot studio',
  'copilot',
  'ai builder',
  'low-code ai',
  'generative ai power platform',
  'copilot developer',
  'copilot for dynamics 365',
  
  // Common abbreviations and variations
  'd365',
  'powerbi',
  'powerapps',
  'powerautomate',
];

// Compile regex patterns once for performance
const REQUIRED_PATTERNS = REQUIRED_KEYWORDS.map(keyword => 
  new RegExp(keyword.replace(/\s+/g, '\\s*'), 'i')
);

// UTILITY FUNCTIONS

/**
 * Checks if a string is empty or contains only whitespace
 */
function isEmptyOrWhitespace(value) {
  if (value === null || value === undefined) return true;
  if (typeof value !== 'string') return true;
  return value.trim().length === 0;
}

/**
 * Safely extracts text content from a value that might be null, undefined, or non-string
 */
function extractText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object' && value.toString) return value.toString().trim();
  return String(value).trim();
}

/**
 * Extracts skills array and normalizes it to a searchable string
 */
function extractSkills(skills) {
  if (!skills) return '';
  
  // Handle array
  if (Array.isArray(skills)) {
    return skills
      .filter(skill => skill && typeof skill === 'string' && skill.trim().length > 0)
      .map(skill => skill.trim())
      .join(' ');
  }
  
  // Handle string
  if (typeof skills === 'string') {
    return skills.trim();
  }
  
  return '';
}

/**
 * Checks if job contains at least one required keyword
 */
function containsRequiredKeywords(job) {
  try {
    // Extract and prepare text fields
    const title = extractText(job.title).toLowerCase();
    const description = extractText(job.description).toLowerCase();
    const skills = extractSkills(job.skills).toLowerCase();
    
    // Combine all searchable text
    const combinedText = `${title} ${description} ${skills}`;
    
    // If combined text is empty, we can't determine - exclude
    if (combinedText.trim().length === 0) return false;
    
    // Check if ANY pattern matches (at least one keyword must be present)
    for (const pattern of REQUIRED_PATTERNS) {
      if (pattern.test(combinedText)) {
        return true; // Found at least one required keyword
      }
    }
    
    return false; // No required keywords found
  } catch (error) {
    logger.error(`Error checking required keywords for job ${job.id}: ${error.message}`);
    // If we can't determine, exclude for safety
    return false;
  }
}

//Validates that job has required fields with actual content
function hasValidFields(job) {
  if (!job) return false;

  if (isEmptyOrWhitespace(job.title)) return false;
  if (isEmptyOrWhitespace(job.description)) return false;
  
  return true;
}

/**
 * Comprehensive job validation and filtering
 */
function isValidJob(job) {
  if (!job) return false;
  if (!hasValidFields(job)) return false;
  if (!containsRequiredKeywords(job)) return false;
  
  return true;
}

/**
 * Filters an array of jobs based on validation rules
 */
function filterValidJobs(jobs) {
  if (!Array.isArray(jobs)) return [];
  
  return jobs.filter(job => {
    try {
      return isValidJob(job);
    } catch (error) {
      logger.error(`Error validating job ${job?.id}: ${error.message}`);
      return false;
    }
  });
}

function filterValidJobs(jobs) {
  if (!Array.isArray(jobs)) return [];
  
  return jobs.filter(job => {
    try {
      return isValidJob(job);
    } catch (error) {
      logger.error(`Error validating job ${job?.id}: ${error.message}`);
      return false; // Exclude on error
    }
  });
}

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

  // Build features (filter is async in case you later add async steps)
  const features = new APIFeatures(reqQuery);
  await features.filter();
  features.sort().limitFields().paginate();
  const options = features.build();

  const pageLimit = (options._limit && Number(options._limit)) || 10;
  const candidateFetchLimit = Math.min(CANDIDATE_LIMIT, Math.max(100, pageLimit * CANDIDATE_MULTIPLIER));

  const candidateQuery = {
    where: options.where || {},
    take: candidateFetchLimit,
    select: options.select || undefined,
    orderBy: options.orderBy || undefined,
  };

  // If select was removed (undefined), Prisma will return all fields
  let candidates = [];
  try {
    candidates = await prisma.job.findMany(candidateQuery);
  } catch (err) {
    logger.error(`Prisma findMany error: ${err.message}`);
    throw err;
  }

  // If no fuzzy requested, do normal pagination query (use count + findMany with skip/take)
  const fuzzyEnabled = !!(features.fuzzy && (features.fuzzy.keyword || features.fuzzy.location));

  let jobs = [];
  let totalJobs = 0;

  if (!fuzzyEnabled) {
    // Non-fuzzy path: we can rely on Prisma options with skip & take (already in options)
    try {
      let rawJobs = await prisma.job.findMany({
        where: {
          ...options.where,
          postedDate: { gte: thirtyDaysAgo },
          jobStatus: { equals: "active" },
        },
        orderBy: options.orderBy || [{ postedDate: "desc" }],
        select: options.select,
        skip: options.skip,
        take: options.take * 3,
      });

      const validJobs = filterValidJobs(rawJobs);
      
      jobs = validJobs.slice(0, options.take || 10);

      const allJobsForCount = await prisma.job.findMany({
        where: {
          ...options.where,
          postedDate: { gte: thirtyDaysAgo },
          jobStatus: { equals: "active" },
        },
        select: {
          id: true,
          title: true,
          description: true
        },
      });

      totalJobs = filterValidJobs(allJobsForCount).length;

      await redisClient.set(cacheKey, JSON.stringify(jobs), 'EX', 60);
    } catch (err) {
      logger.error(`Prisma findMany/count error: ${err.message}`);
      throw err;
    }
  } else {
    try {
      // Build fuse keys with weights
      const fuseKeys = [];
      if (features.fuzzy.keyword) {
        fuseKeys.push({ name: 'title', weight: 0.6 });
        fuseKeys.push({ name: 'description', weight: 0.3 });
        fuseKeys.push({ name: 'companyName', weight: 0.1 });
      }
      if (features.fuzzy.location) {
        // lower weights for location so keyword relevance remains primary
        fuseKeys.push({ name: 'city', weight: 0.35 });
        fuseKeys.push({ name: 'state', weight: 0.25 });
        fuseKeys.push({ name: 'country', weight: 0.2 });
      }

      candidates = candidates.filter(job =>{
        try {
          return (
            new Date(job.postedDate) >= thirtyDaysAgo &&
            job.jobStatus === 'active'
          );
        } catch (error) {
          logger.error(`Error filtering candidate job ${job?.id}: ${error.message}`);
          return false;
        }
      });

      candidates = filterValidJobs(candidates);
      
      // If no candidates returned, short-circuit
      if (!candidates || candidates.length === 0) {
        jobs = [];
        totalJobs = 0;
      } else {
        // Configure Fuse
        const fuse = new Fuse(candidates, {
          keys: fuseKeys,
          threshold: 0.45,
          ignoreLocation: true,
          includeScore: true,
          useExtendedSearch: false,
        });

        // Build composite search string
        const searchTerms = [];
        if (features.fuzzy.keyword) searchTerms.push(features.fuzzy.keyword);
        if (features.fuzzy.location) searchTerms.push(features.fuzzy.location);
        const compositeSearch = searchTerms.join(' ').trim();

        // Run search (if compositeSearch empty, treat all candidates as matched with score 0)
        const fuseResults = compositeSearch 
          ? fuse.search(compositeSearch) 
          : candidates.map(c => ({ item: c, score: 0 }));

        // Map to items with numeric score (fuse score can be undefined in some cases)
        const scored = fuseResults.map(r => ({ item: r.item, score: typeof r.score === 'number' ? r.score : 0 }));

        scored.sort((a, b) => {
          // Check if user wants relevancy sorting
          const wantsRelevancySort = options.orderBy && 
            options.orderBy.some(order => Object.keys(order).includes('id'));
          
          if (wantsRelevancySort) {
            // User wants relevancy - sort by fuzzy score first
            if (a.score !== b.score) return a.score - b.score;
          }
          
          // For date sorting or when scores are equal, use user-specified sort
          if (options.orderBy && options.orderBy.length > 0) {
            for (const sortRule of options.orderBy) {
              const field = Object.keys(sortRule)[0];
              const direction = sortRule[field];

              // Skip the 'id' field used for relevancy indicator
              if (field === 'id') continue;

              let aVal = a.item[field];
              let bVal = b.item[field];

              if (aVal == null && bVal == null) continue;
              if (aVal == null) return 1;
              if (bVal == null) return -1;

              // Convert dates to timestamps
              if (field === 'postedDate' || field === 'createdAt') {
                aVal = new Date(aVal || 0).getTime();
                bVal = new Date(bVal || 0).getTime();
              }

              // Handle numeric fields
              if (typeof aVal === 'number' && typeof bVal === 'number') {
                if (aVal !== bVal) return direction === 'desc' ? bVal - aVal : aVal - bVal;
              }

              // Handle strings
              if (typeof aVal === 'string' && typeof bVal === 'string') {
                if (aVal !== bVal) return direction === 'desc' ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal);
              }
            }
          }

          // Final fallback: postedDate descending
          return new Date(b.item.postedDate).getTime() - new Date(a.item.postedDate).getTime();
        });


        // // Sort ascending by score, then fallback to createdAt desc
        // scored.sort((a, b) => {
        //   if (a.score !== b.score) return a.score - b.score; // ascending: best (smallest) first
        //   const ta = new Date(a.item.createdAt || 0).getTime();
        //   const tb = new Date(b.item.createdAt || 0).getTime();
        //   return tb - ta; // newer first
        // });

        // Pagination (cast options._page/_limit to Number for safety)
        const page = Math.floor((options.skip || 0) / (options.take || 10)) + 1;
        const limit = options.take || 10;
        totalJobs = scored.length;

        const start = (page - 1) * limit;
        const end = start + limit;

        // Slice and extract items
        jobs = scored.slice(start, end).map(x => x.item);
      }
    } catch (err) {
      logger.error(`Fuzzy search error: ${err.message}`);
      throw err;
    }
  }

  // Cache the payload (short TTL)
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
      roleCategory: currentJob.roleCategory,
      postedDate: { gte: thirtyDaysAgo }
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