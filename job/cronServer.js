require('dotenv').config();
const cron = require('node-cron');
const googleAnalytics = require('../services/googleAnalytics.service');
const logger = require('../config/logger');
const { subDays } = require('date-fns');

// Graceful shutdown handler
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

logger.info('Starting Analytics Cron Server...');

/**
 * Daily GA4 data sync - runs at 2 AM every day
 * Syncs yesterday's data (GA4 has a 24-48h delay for complete data)
 */
cron.schedule('0 2 * * *', async () => {
    try {
        logger.info('Starting daily GA4 data sync...');
        
        // Sync yesterday's data (GA4 data is more complete after 24-48h)
        const yesterday = subDays(new Date(), 1);
        await googleAnalytics.storeDailyMetrics(yesterday);
        
        // Also sync day before yesterday to ensure completeness
        const dayBefore = subDays(new Date(), 2);
        await googleAnalytics.storeDailyMetrics(dayBefore);
        
        logger.info('Daily GA4 data sync completed successfully');
    } catch (error) {
        logger.error('Error in daily GA4 sync:', error);
    }
}, {
    timezone: "UTC" // or your preferred timezone
});

/**
 * Hourly sync for real-time data (current day)
 * Runs every hour during business hours
 */
cron.schedule('0 9-18 * * *', async () => {
    try {
        logger.info('Starting hourly GA4 sync for today...');
        
        // Sync today's data (less accurate but more real-time)
        const today = new Date();
        await googleAnalytics.storeDailyMetrics(today);
        
        logger.info('Hourly GA4 sync completed');
    } catch (error) {
        logger.error('Error in hourly GA4 sync:', error);
    }
}, {
    timezone: "UTC"
});

/**
 * Weekly cleanup - runs every Sunday at 3 AM
 * Removes old page view data to keep database size manageable
 */
cron.schedule('0 3 * * 0', async () => {
    try {
        logger.info('Starting weekly analytics cleanup...');
        
        const sixMonthsAgo = subDays(new Date(), 180);
        const prisma = require('../config/prisma');
        
        // Keep site metrics but remove detailed page views older than 6 months
        const deletedRows = await prisma.pageView.deleteMany({
            where: {
                date: {
                    lt: sixMonthsAgo
                }
            }
        });
        
        logger.info(`Weekly cleanup completed. Deleted ${deletedRows.count} old page view records.`);
    } catch (error) {
        logger.error('Error in weekly cleanup:', error);
    }
}, {
    timezone: "UTC"
});

// Health check endpoint for monitoring
const express = require('express');
const app = express();
const PORT = process.env.CRON_PORT || 3001;

app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        service: 'analytics-cron',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, () => {
    logger.info(`Analytics Cron Server health check running on port ${PORT}`);
});

logger.info('All cron jobs scheduled and running...');