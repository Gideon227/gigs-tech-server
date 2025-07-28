const prisma = require('../config/prisma');
const redisClient = require('../config/redisClient');
const logger = require('../config/logger');
const { startOfDay, endOfDay, subDays, format } = require('date-fns');

const propertyId = process.env.GA_PROPERTY_ID; // e.g. '123456789'
const client = new BetaAnalyticsDataClient({
  credentials: {
    client_email: process.env.GA_CLIENT_EMAIL,
    private_key: process.env.GA_PRIVATE_KEY.replace(/\\n/g, '\n'),
  },
});
const analyticsClient = google.analyticsdata({
  version: 'v1beta',
  auth,
});


exports.getJobAnalytics = async (req, res) => {
    const CACHE_KEY = 'jobs:analytics';
    const CACHE_TTL = 60;
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

exports.getAnalyticsData = async () => {
    const CACHE_KEY  = 'ga4:weekly_report';
    const CACHE_TTL  = 300;

    const cached = await redisClient.get(CACHE_KEY);
    if (cached) {
        return JSON.parse(cached);
    }

    const [response] = await analyticsClient.properties.runReport({
        property: `properties/${propertyId}`,
        requestBody: {
        dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
        dimensions: [{ name: 'pagePath' }],
        metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }],
        },
    });

    await redisClient.set(CACHE_KEY, JSON.stringify(response), 'EX', CACHE_TTL);
    return response;
};



// exports.getDashboardAnalytics = async (req, res) => {
//     try {
//         const cached = await redisClient.get('dashboard:analytics');
//         if (cached) {
//             logger.debug('Cache hit for dashboard analytics');
//             return JSON.parse(cached);
//         }
//     } catch (err) {
//         logger.error(`Redis GET error for dashboard analytics: ${err.message}`);
//     }

//     const now = new Date();
//     const todayStart = startOfDay(now);
//     const yesterday = subDays(now, 1);
//     const monthAgo = subDays(now, 30);

//     // Get job analytics 
//     const jobAnalytics = await this.getJobAnalytics();

//     // Get website analytics from database
//     const [todayGA, yesterdayGA, monthlyGA] = await Promise.all([
//         prisma.siteMetrics.findUnique({
//             where: { date: todayStart }
//         }),
//         prisma.siteMetrics.findUnique({
//             where: { date: startOfDay(yesterday) }
//         }),
//         prisma.siteMetrics.findMany({
//             where: {
//                 date: {
//                     gte: monthAgo,
//                     lte: todayStart
//                 }
//             },
//             orderBy: { date: 'asc' }
//         })
//     ]);

//     // Get top performing job pages
//     const topJobPages = await prisma.pageView.findMany({
//         where: {
//             date: {
//                 gte: subDays(now, 7) 
//             },
//             pagePath: {
//                 contains: '/browse-jobs/' 
//             }
//         },
//         select: {
//             pagePath: true,
//             pageTitle: true,
//             pageViews: true,
//             users: true,
//             sessions: true
//         },
//         orderBy: {
//             pageViews: 'desc'
//         },
//         take: 10
//     });

//     // Calculate job application conversion rate
//     const jobApplications = await prisma.siteMetrics.aggregate({
//         where: {
//             date: {
//                 gte: monthAgo
//             }
//         },
//         _sum: {
//             jobApplications: true,
//             sessions: true
//         }
//     });

//     const conversionRate = jobApplications._sum.sessions > 0 
//         ? (jobApplications._sum.jobApplications / jobApplications._sum.sessions) * 100 
//         : 0;

//     const result = {
//         jobs: jobAnalytics,
        
//         // Website analytics
//         website: {
//             today: {
//                 users: todayGA?.totalUsers || 0,
//                 sessions: todayGA?.sessions || 0,
//                 pageViews: todayGA?.pageViews || 0,
//                 bounceRate: todayGA?.bounceRate || 0,
//                 avgSessionDuration: todayGA?.avgSessionDuration || 0,
//                 conversions: todayGA?.conversions || 0
//             },
//             yesterday: {
//                 users: yesterdayGA?.totalUsers || 0,
//                 sessions: yesterdayGA?.sessions || 0,
//                 pageViews: yesterdayGA?.pageViews || 0,
//                 bounceRate: yesterdayGA?.bounceRate || 0,
//                 avgSessionDuration: yesterdayGA?.avgSessionDuration || 0,
//                 conversions: yesterdayGA?.conversions || 0
//             },
//             chartData: monthlyGA.map(day => ({
//                 date: day.date,
//                 users: day.totalUsers,
//                 sessions: day.sessions,
//                 pageViews: day.pageViews,
//                 bounceRate: day.bounceRate,
//                 conversions: day.conversions
//             })),
//             topPages: todayGA?.topPages || [],
//             topSources: todayGA?.topSources || [],
//             deviceBreakdown: todayGA?.deviceBreakdown || []
//         },
        
//         // Combined insights
//         insights: {
//             topJobPages,
//             conversionRate: Math.round(conversionRate * 100) / 100,
//             totalJobViews: topJobPages.reduce((sum, page) => sum + page.pageViews, 0)
//         }
//     };

//     try {
//         await redisClient.set('dashboard:analytics', JSON.stringify(result), 'EX', 300); // 5 min cache
//         logger.debug('Cache set for dashboard analytics');
//     } catch (err) {
//         logger.error(`Redis SET error for dashboard analytics: ${err.message}`);
//     }

//     return result;
// };

// exports.getTrafficSources = async () => {
//     const cacheKey = 'analytics:traffic-sources';
    
//     try {
//         const cached = await redisClient.get(cacheKey);
//         if (cached) {
//             return JSON.parse(cached);
//         }
//     } catch (err) {
//         logger.error(`Redis GET error: ${err.message}`);
//     }

//     const last30Days = subDays(new Date(), 30);
    
//     const sources = await prisma.pageView.groupBy({
//         by: ['source', 'medium'],
//         where: {
//             date: {
//                 gte: last30Days
//             }
//         },
//         _sum: {
//             sessions: true,
//             users: true,
//             pageViews: true
//         },
//         orderBy: {
//             _sum: {
//                 sessions: 'desc'
//             }
//         },
//         take: 10
//     });

//     const result = sources.map(source => ({
//         source: source.source,
//         medium: source.medium,
//         sessions: source._sum.sessions,
//         users: source._sum.users,
//         pageViews: source._sum.pageViews
//     }));

//     try {
//         await redisClient.set(cacheKey, JSON.stringify(result), 'EX', 600); // 10 min cache
//     } catch (err) {
//         logger.error(`Redis SET error: ${err.message}`);
//     }

//     return result;
// };

// exports.getGeographicData = async () => {
//     const cacheKey = 'analytics:geographic';
    
//     try {
//         const cached = await redisClient.get(cacheKey);
//         if (cached) {
//             return JSON.parse(cached);
//         }
//     } catch (err) {
//         logger.error(`Redis GET error: ${err.message}`);
//     }

//     const last30Days = subDays(new Date(), 30);
    
//     const countries = await prisma.pageView.groupBy({
//         by: ['country'],
//         where: {
//             date: {
//                 gte: last30Days
//             },
//             country: {
//                 not: null
//             }
//         },
//         _sum: {
//             sessions: true,
//             users: true
//         },
//         orderBy: {
//             _sum: {
//                 sessions: 'desc'
//             }
//         },
//         take: 15
//     });

//     const result = countries.map(country => ({
//         country: country.country,
//         sessions: country._sum.sessions,
//         users: country._sum.users
//     }));

//     try {
//         await redisClient.set(cacheKey, JSON.stringify(result), 'EX', 600);
//     } catch (err) {
//         logger.error(`Redis SET error: ${err.message}`);
//     }

//     return result;
// };