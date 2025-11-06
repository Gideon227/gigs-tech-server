const prisma = require('../config/prisma');
const APIFeatures = require('../utils/apiFeatures');
const redisClient = require('../config/redisClient');
const logger = require('../config/logger');
const Fuse = require('fuse.js');

const CANDIDATE_LIMIT = 2000; // max rows to fetch for fuzzy processing
const CANDIDATE_MULTIPLIER = 10;
const CACHE_TTL = 60;

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
  "Microsoft Power Platform",
  "Power Platform",
  "Power Apps",
  "Power Automate",
  "Power BI",
  "Power Virtual Agents",
  "Power Pages",
  "Dataverse",
  "Power Fx",
  "Canvas App",
  "Model-driven App",
  "Power Platform Developer",
  "Power Platform Consultant",
  "Power Platform Architect",
  "Power Platform Engineer",
  "Power Platform Administrator",
  "Power Platform Support",
  "Power Platform Specialist",
  "Power Platform Solution",
  "Dynamics 365",
  "Dynamics CRM",
  "Dynamics AX",
  "Dynamics NAV",
  "Dynamics GP",
  "Business Central",
  "D365 F&O",
  "D365FO",
  "D365 Finance",
  "D365 Supply Chain",
  "D365 Sales",
  "D365 Customer Service",
  "D365 Field Service",
  "D365 Marketing",
  "D365 Project Operations",
  "D365 HR",
  "D365 Talent",
  "Dynamics Developer",
  "Dynamics Consultant",
  "Dynamics Architect",
  "Dynamics Administrator",
  "Dynamics Functional Consultant",
  "Dynamics Technical Consultant",
  "Dynamics Support",
  "Dynamics Solution Architect",
  "Microsoft Copilot",
  "Copilot for Power Platform",
  "Power Platform Copilot",
  "Copilot Studio",
  "Copilot for Power Apps",
  "Copilot for Power Automate",
  "Copilot for Power BI",
  "Copilot for Dynamics 365",
  "Dynamics Copilot",
  "Copilot for Sales",
  "Copilot for Service",
  "Copilot for Finance",
  "Copilot for Supply Chain",
  "Azure OpenAI",
  "AI Builder",
  "Low-code AI",
  "Generative AI Power Platform",
  "Copilot Developer",
  "Copilot Consultant",

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
  '365',
  
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
  'low-code platform', 
  'no code', 
  'automation', 
  'microsoft apps',
  'dataverse', 
  'canvas app', 
  'model driven app',
  'microsoft business applications', 
  'crm developer',
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

    for (const keyword of REQUIRED_KEYWORDS) {
      const simpleKeyword = keyword.toLowerCase().replace(/\s+/g, " ").trim();
      if (
        combinedText.includes(simpleKeyword) || 
        title.includes(simpleKeyword) // strong bias to title
      ) {
        return true;
      }
    }

    // Title-only fallback if description is missing
    if (!skills && REQUIRED_KEYWORDS.some(k => title.includes(k.toLowerCase()))) {
      return true;
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

  const features = new APIFeatures(reqQuery);
  await features.filter();
  features.sort().limitFields().paginate();
  const options = features.build();

  const limit = options.take || 10;
  const skip = options.skip || 0;
  
  const fuzzyEnabled = !!(features.fuzzy && (features.fuzzy.keyword || features.fuzzy.location));
  
  const candidateFetchLimit = Math.min(
    CANDIDATE_LIMIT,
    Math.max(100, limit * CANDIDATE_MULTIPLIER)
  );

  let rawJobs = [];
  let jobs = [];
  let totalJobs = 0;

  try {
    rawJobs = await prisma.job.findMany({
      where: {
        ...options.where,
        postedDate: { gte: thirtyDaysAgo },
        jobStatus: { equals: "active" },
      },
      select: options.select,
      orderBy: options.orderBy || [{ postedDate: "desc" }],
      take: candidateFetchLimit,
    });
  } catch (err) {
    logger.error(`Prisma fetch all job, error: ${err.message}`);
    throw err;
  }

  // NON-FUZZY SEARCH
  if (!fuzzyEnabled) {
    const validJobs = filterValidJobs(rawJobs);
    totalJobs = validJobs.length;
    const paginatedJobs = validJobs.slice(skip, skip + limit);
    jobs = paginatedJobs;
  } 
  // FUZZY SEARCH
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

      if (!rawJobs || rawJobs.length === 0) {
        jobs = [];
        totalJobs = 0;
      } else {
        const fuse = new Fuse(rawJobs, {
          keys: fuseKeys,
          threshold: 0.45,
          ignoreLocation: true,
          includeScore: true,
        });

        const searchTerms = [];
        if (features.fuzzy.keyword) searchTerms.push(features.fuzzy.keyword);
        if (features.fuzzy.location) searchTerms.push(features.fuzzy.location);
        const compositeSearch = searchTerms.join(' ').trim();

        // Run search (if compositeSearch empty, treat all rawJobs as matched with score 0)
        const fuseResults = compositeSearch 
          ? fuse.search(compositeSearch) 
          : rawJobs.map(c => ({ item: c, score: 0 }));

        const scored = fuseResults.map(r => ({
          item: r.item,
          score: typeof r.score === 'number' ? r.score : 0
        }));
          
        const validJobs = filterValidJobs(scored);
        // const paginatedJobs = validJobs.slice(skip, skip + limit);

        // validJobs.sort((a, b) => {
        //   const wantsRelevancySort = options.orderBy &&
        //     options.orderBy.some(order => Object.keys(order).includes('id'));

        //   if (wantsRelevancySort && a.score !== b.score) {
        //     return a.score - b.score;
        //   }

        //   if (options.orderBy && options.orderBy.length > 0) {
        //     for (const sortRule of options.orderBy) {
        //       const field = Object.keys(sortRule)[0];
        //       const direction = sortRule[field];
        //       if (field === 'id') continue;

        //       let aVal = a.item[field];
        //       let bVal = b.item[field];

        //       if (aVal == null && bVal == null) continue;
        //       if (aVal == null) return 1;
        //       if (bVal == null) return -1;

        //       // Convert dates to timestamps
        //       if (field === 'postedDate' || field === 'createdAt') {
        //         aVal = new Date(aVal || 0).getTime();
        //         bVal = new Date(bVal || 0).getTime();
        //       }

        //       if (typeof aVal === 'number' && typeof bVal === 'number') {
        //         if (aVal !== bVal) return direction === 'desc' ? bVal - aVal : aVal - bVal;
        //       }

        //       if (typeof aVal === 'string' && typeof bVal === 'string') {
        //         if (aVal !== bVal) return direction === 'desc' ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal);
        //       }
        //     }
        //   }

        //   return new Date(b.item.postedDate).getTime() - new Date(a.item.postedDate).getTime();
        // });

        validJobs.sort((a, b) => {
          if (a._score !== b._score) return a._score - b._score;
          return new Date(b.postedDate) - new Date(a.postedDate);
        });

        totalJobs = validJobs.length;
        jobs = validJobs.slice(skip, skip + limit);
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

  const rawJobs = await prisma.job.findMany({
    where: {
      id: { not: jobId },
      roleCategory: currentJob.roleCategory,
      postedDate: { gte: thirtyDaysAgo },
    },
  });

  const related = rawJobs
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
