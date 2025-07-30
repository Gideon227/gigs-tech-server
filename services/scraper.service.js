const prisma = require('../config/prisma');

exports.logScraperRun = (data) => {
    return prisma.scraperRun.create({ data: {
        totalJobs: data.totalJobs,
        brokenLinks: data.brokenLinks,
        ipBlockedCount: data.ipBlockedCount,
        successful: data.brokenLinks === 0 && data.ipBlockedCount === 0,
        durationMs: data.durationMs,
    }});
}

exports.getScraperMetrics = async (intervalInHours = 24) => {
    const since = new Date(Date.now() - intervalInHours * 3600 * 1000);
    const runs = await prisma.scraperRun.findMany({ where: { createdAt: { gte: since } } });
    const total = runs.length;
    const succeeded = runs.filter(r => r.successful).length;
    return {
        totalRuns: total,
        successRate: total ? (succeeded / total) * 100 : 0,
        brokenLinksLastRun: runs[total - 1]?.brokenLinks ?? 0,
        ipBlockedLastRun: runs[total - 1]?.ipBlockedCount ?? 0,
    };
}