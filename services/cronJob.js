const cron = require('node-cron');
const prisma = require('../config/prisma'); 
const logger = require('../config/logger');

cron.schedule('0 * * * *', async () => {
  try {
    const cutoffTime = new Date(Date.now() - 36 * 60 * 60 * 1000);

    const result = await prisma.job.updateMany({
      where: {
        updatedAt: { lt: cutoffTime },
        jobStatus: { not: 'expired' }
      },
      data: { jobStatus: 'expired' }
    });

    logger.info(`Expired ${result.count} jobs older than 36 hours`);
  } catch (err) {
    logger.error(`Error expiring jobs: ${err.message}`);
  }
});
