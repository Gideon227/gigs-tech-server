const cron = require('node-cron');
const prisma = require('../config/prisma'); 
const logger = require('../config/logger');

cron.schedule('0 * * * *', async () => {
  
  try {
    const now = new Date();
    const cutoffTime = new Date(Date.now() - 36 * 60 * 60 * 1000);

    logger.info(`Current time: ${now.toISOString()}`);
    logger.info(`Cutoff time: ${cutoffTime()}`);

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

    //----- 30 Days jobs -----//
    const cutoff30days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    logger.info(`30-day cutoff UTC: ${cutoff30days.toISOString()}`);

    const result30days = await prisma.job.updateMany({
      where: {
        postedDate: { lt: cutoff30days },
        jobStatus: { not: 'expired' }
      },
      data: { jobStatus: 'expired' }
    });

    logger.info(`Expired ${result30days.count} jobs older than 30 days`);

  } catch (err) {
    logger.error(`Error expiring jobs: ${err.message}`);
  }
});
