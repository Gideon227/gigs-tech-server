const cron = require('node-cron');
const prisma = require('../config/prisma'); 
const logger = require('../config/logger');

const safeStr = (v) => (v ?? '').toString().trim().toLowerCase(); 

cron.schedule('0 * * * *', async () => {
  const now = new Date();
  
  try {
    logger.info(`[CRON] start: ${now.toISOString()}`);
    
    const expire36h = await prisma.$executeRaw`
      UPDATE "job"
      SET "jobStatus" = 'inactive'
      WHERE "jobStatus" <> 'inactive'
        AND "updatedAt" < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '24 hours'
    `;

    logger.info(`[CRON] expired (>36h updatedAt): ${expire36h ?? 'OK'}`);

    // --- Expire > 30d by postedDate (DB computes cutoff in UTC) ---
    const expire30d = await prisma.$executeRaw`
      UPDATE "job"
      SET "jobStatus" = 'expired'
      WHERE "jobStatus" <> 'expired'
        AND "postedDate" < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '30 days'
    `;
    logger.info(`[CRON] expired (>30d postedDate): ${expire30d ?? 'OK'}`);

    // --- Deduplication ---
    const jobs = await prisma.job.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        description: true,
        companyName: true,
        city: true,
        state: true,
        salary: true,
      },
    });

    const seen = new Set();
    const dupIds = [];
    for (const j of jobs) {
      const key = [
        safeStr(j.title),
        safeStr(j.description),
        safeStr(j.companyName),
        safeStr(j.city),
        safeStr(j.state),
        safeStr(j.salary),
      ].join('|');

      if (seen.has(key)) dupIds.push(j.id);
      else seen.add(key);
    }

    if (dupIds.length) {
      // chunk to avoid huge IN() lists
      const CHUNK = 1000;
      for (let i = 0; i < dupIds.length; i += CHUNK) {
        await prisma.job.updateMany({
          where: { id: { in: dupIds.slice(i, i + CHUNK) } },
          data: { jobStatus: 'duplicates' },
        });
      }
    }
    logger.info(`[CRON] marked duplicates: ${dupIds.length}`);

    const finished = new Date();
    logger.info(`[CRON] done: ${finished.toISOString()} (took ${finished - started}ms)`);

  } catch (err) {
    logger.error(`Error expiring jobs: ${err.message}`);
  }
});
