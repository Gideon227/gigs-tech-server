const cron = require('node-cron');
const prisma = require('../config/prisma'); 
const logger = require('../config/logger');

cron.schedule('0 2 * * *', async () => {
  
  try {
    const cutoffTime = new Date(Date.now() - 36 * 60 * 60 * 1000);

    logger.info(`Current time: ${now.toISOString()}`);
    logger.info(`Cutoff time: ${cutoffTime.toISOString()}`);

    const result = await prisma.job.updateMany({
      where: {
        updatedAt: { lt: cutoffTime },
        jobStatus: { not: 'expired' }
      },
      data: { jobStatus: 'expired' }
    });

    logger.info(`Expired ${result.count} jobs older than 36 hours`);

    // --- Deduplication ---
    const jobs = await prisma.job.findMany({
      orderBy: { updatedAt: 'desc' }, // newest first
    });

    const seen = new Set();
    const duplicateIds = [];

    for (const job of jobs) {
      const key = `${job.title?.trim().toLowerCase()}-${job.description?.trim().toLowerCase()}-${job.companyName?.trim().toLowerCase()}-${job.city?.trim().toLowerCase()}-${job.state?.trim().toLowerCase()}-${job.salary?.trim().toLowerCase()}`;

      if (seen.has(key)) {
        duplicateIds.push(job.id);
      } else {
        seen.add(key);
      }
    }

    if (duplicateIds.length > 0) {
      await prisma.job.updateMany({
        where: { id: { in: duplicateIds } },
        data: { jobStatus: 'duplicates' }
      });
      logger.info(`Deleted ${duplicateIds.length} duplicate jobs`);
    }

  } catch (err) {
    logger.error(`Error expiring jobs: ${err.message}`);
  }
});
