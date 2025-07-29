const prisma = require('../config/prisma');
const scraperService = require("./scraper.service")
const cron = require('node-cron');


// Every day at midnight UTC 
cron.schedule('0 0 * * *', async () => {
    const start = Date.now();
    const since = new Date(Date.now() - 24 * 3600 * 1000);

    const totalJobs = await prisma.job.count({ where: { createdAt: { gte: since } } });

    const brokenLinks = await prisma.job.count({ where: { brokenLink: true, updatedAt: { gte: since } } });

    const ipBlockedCount = await prisma.job.count({ where: { ipBlocked: true, updatedAt: { gte: since } } });

    const durationMs = Date.now() - start;
    await scraperService.logScraperRun({ totalJobs, brokenLinks, ipBlockedCount, durationMs });
    console.log(`Logged scraper health: ${totalJobs} jobs, ${brokenLinks} broken links, ${ipBlockedCount} ip‑blocks in ${durationMs}ms.`);
});
