const cron = require('node-cron');
const prisma = require('../config/prisma'); 
const logger = require('../config/logger');

// Run every hour at minute 0
cron.schedule('0 */12 * * *', async () => {
  try {
    const cutoffTime = new Date(Date.now() - 36 * 60 * 60 * 1000);

    const result = await prisma.job.updateMany({
      where: {
        updatedAt: { gt: cutoffTime },
        jobStatus: { not: 'expired' }
      },
      data: { jobStatus: 'expired' }
    });

    logger.info(`Expired ${result.count} jobs older than 14 hours`);
  } catch (err) {
    logger.error(`Error expiring jobs: ${err.message}`);
  }
});
