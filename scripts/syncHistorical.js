require('dotenv').config();
const googleAnalytics = require('../services/googleAnalytics.service');
const logger = require('../config/logger');

async function syncHistorical() {
  try {
    const days = process.argv[2] || 30;
    logger.info(`Starting historical sync for ${days} days...`);
    
    await googleAnalytics.syncHistoricalData(parseInt(days));
    
    logger.info('Historical sync completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Historical sync failed:', error);
    process.exit(1);
  }
}

syncHistorical();

