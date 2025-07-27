require('dotenv').config();
const googleAnalytics = require('../services/googleAnalytics.service');
const logger = require('../config/logger');
const { subDays } = require('date-fns');

async function syncYesterday() {
  try {
    logger.info('Starting yesterday sync...');
    
    const yesterday = subDays(new Date(), 1);
    await googleAnalytics.storeDailyMetrics(yesterday);
    
    logger.info('Yesterday sync completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Yesterday sync failed:', error);
    process.exit(1);
  }
}

syncYesterday();