const prisma = require('../config/prisma');
const redisClient = require('../config/redisClient');
const logger = require('../config/logger');
const { startOfDay, endOfDay, subDays } = require('date-fns');


const CACHE_KEY = 'jobs:analytics';
const CACHE_TTL = 60;

exports.getJobAnalytics = async (req, res) => {
    try {
        const cached = await redisClient.get(CACHE_KEY);
        if (cached) {
            logger.debug(`Cache hit for ${CACHE_KEY}`);
            return JSON.parse(cached);
        }
    } catch (err) {
        logger.error(`Redis GET error for ${CACHE_KEY}: ${err.message}`);
    }

    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd   = endOfDay(now);
    const yesterday  = subDays(now, 1);
    const yestStart  = startOfDay(yesterday);
    const yestEnd    = endOfDay(yesterday);
    const monthAgo   = subDays(now, 30);

    const [
        todayTotal,      yesterdayTotal,
        todayActive,     yesterdayActive,
        todayExpired,    yesterdayExpired,
        todayBroken,     yesterdayBroken
    ] = await Promise.all([
        prisma.job.count({ where: { createdAt: { gte: todayStart, lte: todayEnd } } }),
        prisma.job.count({ where: { createdAt: { gte: yestStart,   lte: yestEnd } } }),

        prisma.job.count({ where: { createdAt: { gte: todayStart, lte: todayEnd },   jobStatus: 'active'  } }),
        prisma.job.count({ where: { createdAt: { gte: yestStart,   lte: yestEnd },   jobStatus: 'active'  } }),

        prisma.job.count({ where: { createdAt: { gte: todayStart, lte: todayEnd },   jobStatus: 'expired' } }),
        prisma.job.count({ where: { createdAt: { gte: yestStart,   lte: yestEnd },   jobStatus: 'expired' } }),

        prisma.job.count({ where: { createdAt: { gte: todayStart, lte: todayEnd },   brokenLink: true } }),
        prisma.job.count({ where: { createdAt: { gte: yestStart,   lte: yestEnd },   brokenLink: true } }),
    ]);

    // const chartData = await prisma.$queryRaw`
    //     SELECT
    //     DATE_TRUNC('day', "createdAt")::date AS date,
    //     COUNT(*) AS total,
    //     COUNT(*) FILTER (WHERE "jobStatus" = 'active')   AS active,
    //     COUNT(*) FILTER (WHERE "jobStatus" = 'expired')  AS expired,
    //     COUNT(*) FILTER (WHERE "brokenLink" = true)        AS broken
    //     FROM "job"
    //     WHERE "createdAt" >= ${monthAgo} AND "createdAt" <= ${todayEnd}
    //     GROUP BY date
    //     ORDER BY date ASC;
    // `;

    const chartData = await prisma.$queryRaw`
        WITH date_series AS (
            SELECT generate_series(
            CURRENT_DATE - INTERVAL '29 days',
            CURRENT_DATE,
            INTERVAL '1 day'
            )::DATE AS date
        )
        SELECT
            ds.date,
            COUNT(j.*) AS total,
            COUNT(j.*) FILTER (WHERE j."jobStatus" = 'active') AS active,
            COUNT(j.*) FILTER (WHERE j."jobStatus" = 'expired') AS expired,
            COUNT(j.*) FILTER (WHERE j."brokenLink" = true) AS broken
        FROM date_series ds
        LEFT JOIN "job" j ON DATE(j."createdAt") = ds.date
        GROUP BY ds.date
        ORDER BY ds.date ASC;
    `;


    const safeChartData = chartData.map((row) => ({
        date: row.date,
        total: Number(row.total || 0),
        active: Number(row.active || 0),
        expired: Number(row.expired || 0),
        broken: Number(row.broken || 0),
    }));

    const result = {
        today: {
            total:   todayTotal,
            active:  todayActive,
            expired: todayExpired,
            broken:  todayBroken
        },
        yesterday: {
            total:   yesterdayTotal,
            active:  yesterdayActive,
            expired: yesterdayExpired,
            broken:  yesterdayBroken
        },
        chartData: safeChartData
    };

    try {
        await redisClient.set(CACHE_KEY, JSON.stringify(result), 'EX', CACHE_TTL);
        logger.debug(`Cache set for ${CACHE_KEY} (TTL ${CACHE_TTL}s)`);
    } catch (err) {
        logger.error(`Redis SET error for ${CACHE_KEY}: ${err.message}`);
    }

    return result;
}