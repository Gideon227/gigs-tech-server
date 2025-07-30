const prisma = require('../config/prisma');
const redisClient = require('../config/redisClient');
const logger = require('../config/logger');
const { startOfDay, endOfDay, subDays, format } = require('date-fns');
const { google } = require('googleapis');

const propertyId  = process.env.GA_PROPERTY_ID;
const clientEmail = process.env.GA_CLIENT_EMAIL;
const privateKey  = process.env.GA_PRIVATE_KEY?.replace(/\\n/g, '\n');

if (!propertyId || !clientEmail || !privateKey) {
  logger.error('Missing Google Analytics env vars', {
    propertyId,
    clientEmail,
    hasPrivateKey: !!privateKey,
  });
  throw new Error('Google Analytics env vars not set');
}

const auth = new google.auth.GoogleAuth({
  credentials: { client_email: clientEmail, private_key: privateKey },
  scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
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

    try {
        const cached = await redisClient.get(CACHE_KEY);
        if (cached) {
            logger.debug('GA4: returning cached report');
            return JSON.parse(cached);
        }

        const authClient = await auth.getClient();
        const analytics = google.analyticsdata({
            version: 'v1beta',
            auth: authClient,
            timeout: 10000, 
        });

        logger.debug(`GA4: fetching report for property ${propertyId}`);
        
        const response = await analytics.properties.runReport({
            property: `properties/${propertyId}`,
            requestBody: {
                dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
                dimensions: [{ name: 'pagePath' }],
                metrics: [
                    { name: 'screenPageViews' }, 
                    { name: 'activeUsers' }
                ],
                limit: 1000,
                orderBys: [
                    {
                        metric: { metricName: 'screenPageViews' },
                        desc: true
                    }
                ]
            },
        });

        const responseData = response.data || response;
        if (!responseData) {
            throw new Error('Invalid response from Google Analytics API');
        }

        try {
            await redisClient.set(CACHE_KEY, JSON.stringify(responseData), 'EX', CACHE_TTL);
            logger.debug('GA4: report cached');
        } catch (cacheErr) {
            logger.error('Failed to cache GA4 data:', cacheErr);
        }

        return responseData;

    } catch (err) {
        logger.error('GA4 fetch error in service:', {
            message: err.message,
            stack: err.stack,
            propertyId: propertyId
        });
        
        throw new Error(`Failed to fetch Google Analytics data: ${err.message}`);
    }
};



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