const { BetaAnalyticsDataClient } = require('@google-analytics/data');
const prisma = require('../config/prisma');
const logger = require('../config/logger');
const { subDays, format, startOfDay, endOfDay } = require('date-fns');

class GoogleAnalyticsService {
  constructor() {
    this.analyticsDataClient = new BetaAnalyticsDataClient({
      keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS, // Path to service account JSON
    });
    this.propertyId = process.env.GA4_PROPERTY_ID; // Your GA4 Property ID
  }

  /**
   * Fetch daily site metrics from GA4
   */
  async fetchDailySiteMetrics(startDate, endDate) {
    try {
      const [response] = await this.analyticsDataClient.runReport({
        property: `properties/${this.propertyId}`,
        dateRanges: [
          {
            startDate: format(startDate, 'yyyy-MM-dd'),
            endDate: format(endDate, 'yyyy-MM-dd'),
          },
        ],
        dimensions: [
          { name: 'date' },
        ],
        metrics: [
          { name: 'totalUsers' },
          { name: 'newUsers' },
          { name: 'sessions' },
          { name: 'screenPageViews' },
          { name: 'bounceRate' },
          { name: 'averageSessionDuration' },
          { name: 'conversions' },
        ],
      });

      return response.rows?.map(row => ({
        date: new Date(
          row.dimensionValues[0].value.slice(0, 4),
          parseInt(row.dimensionValues[0].value.slice(4, 2)) - 1,
          row.dimensionValues[0].value.slice(6, 2)
        ),
        totalUsers: parseInt(row.metricValues[0].value) || 0,
        newUsers: parseInt(row.metricValues[1].value) || 0,
        sessions: parseInt(row.metricValues[2].value) || 0,
        pageViews: parseInt(row.metricValues[3].value) || 0,
        bounceRate: parseFloat(row.metricValues[4].value) || 0,
        avgSessionDuration: parseFloat(row.metricValues[5].value) || 0,
        conversions: parseInt(row.metricValues[6].value) || 0,
      })) || [];
    } catch (error) {
      logger.error('Error fetching site metrics from GA4:', error);
      throw error;
    }
  }

  /**
   * Fetch page-level analytics
   */
  async fetchPageAnalytics(startDate, endDate) {
    try {
      const [response] = await this.analyticsDataClient.runReport({
        property: `properties/${this.propertyId}`,
        dateRanges: [
          {
            startDate: format(startDate, 'yyyy-MM-dd'),
            endDate: format(endDate, 'yyyy-MM-dd'),
          },
        ],
        dimensions: [
          { name: 'date' },
          { name: 'pagePath' },
          { name: 'pageTitle' },
          { name: 'sessionSourceMedium' },
          { name: 'country' },
          { name: 'city' },
          { name: 'deviceCategory' },
          { name: 'browser' },
        ],
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
          { name: 'screenPageViews' },
          { name: 'bounceRate' },
          { name: 'averageSessionDuration' },
        ],
        orderBys: [
          {
            dimension: { dimensionName: 'date' },
            desc: false,
          },
        ],
      });

      return response.rows?.map(row => {
        const [source, medium] = row.dimensionValues[3].value.split(' / ');
        
        return {
          date: new Date(
            row.dimensionValues[0].value.slice(0, 4),
            parseInt(row.dimensionValues[0].value.slice(4, 2)) - 1,
            row.dimensionValues[0].value.slice(6, 2)
          ),
          pagePath: row.dimensionValues[1].value,
          pageTitle: row.dimensionValues[2].value,
          source: source || 'direct',
          medium: medium || 'none',
          country: row.dimensionValues[4].value,
          city: row.dimensionValues[5].value,
          deviceCategory: row.dimensionValues[6].value,
          browser: row.dimensionValues[7].value,
          sessions: parseInt(row.metricValues[0].value) || 0,
          users: parseInt(row.metricValues[1].value) || 0,
          pageViews: parseInt(row.metricValues[2].value) || 0,
          bounceRate: parseFloat(row.metricValues[3].value) || 0,
          avgSessionDuration: parseFloat(row.metricValues[4].value) || 0,
        };
      }) || [];
    } catch (error) {
      logger.error('Error fetching page analytics from GA4:', error);
      throw error;
    }
  }

  /**
   * Get top pages and sources for aggregation
   */
  async fetchTopPagesAndSources(startDate, endDate) {
    try {
      // Top Pages
      const [pagesResponse] = await this.analyticsDataClient.runReport({
        property: `properties/${this.propertyId}`,
        dateRanges: [
          {
            startDate: format(startDate, 'yyyy-MM-dd'),
            endDate: format(endDate, 'yyyy-MM-dd'),
          },
        ],
        dimensions: [
          { name: 'pagePath' },
          { name: 'pageTitle' },
        ],
        metrics: [
          { name: 'screenPageViews' },
          { name: 'totalUsers' },
        ],
        orderBys: [
          {
            metric: { metricName: 'screenPageViews' },
            desc: true,
          },
        ],
        limit: 10,
      });

      // Top Sources
      const [sourcesResponse] = await this.analyticsDataClient.runReport({
        property: `properties/${this.propertyId}`,
        dateRanges: [
          {
            startDate: format(startDate, 'yyyy-MM-dd'),
            endDate: format(endDate, 'yyyy-MM-dd'),
          },
        ],
        dimensions: [
          { name: 'sessionSourceMedium' },
        ],
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
        ],
        orderBys: [
          {
            metric: { metricName: 'sessions' },
            desc: true,
          },
        ],
        limit: 10,
      });

      // Device Breakdown
      const [devicesResponse] = await this.analyticsDataClient.runReport({
        property: `properties/${this.propertyId}`,
        dateRanges: [
          {
            startDate: format(startDate, 'yyyy-MM-dd'),
            endDate: format(endDate, 'yyyy-MM-dd'),
          },
        ],
        dimensions: [
          { name: 'deviceCategory' },
        ],
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
        ],
      });

      return {
        topPages: pagesResponse.rows?.map(row => ({
          path: row.dimensionValues[0].value,
          title: row.dimensionValues[1].value,
          pageViews: parseInt(row.metricValues[0].value),
          users: parseInt(row.metricValues[1].value),
        })) || [],
        topSources: sourcesResponse.rows?.map(row => ({
          source: row.dimensionValues[0].value,
          sessions: parseInt(row.metricValues[0].value),
          users: parseInt(row.metricValues[1].value),
        })) || [],
        deviceBreakdown: devicesResponse.rows?.map(row => ({
          device: row.dimensionValues[0].value,
          sessions: parseInt(row.metricValues[0].value),
          users: parseInt(row.metricValues[1].value),
        })) || [],
      };
    } catch (error) {
      logger.error('Error fetching top pages and sources from GA4:', error);
      throw error;
    }
  }

  /**
   * Store daily metrics in database
   */
  async storeDailyMetrics(date) {
    try {
      const startDate = startOfDay(date);
      const endDate = endOfDay(date);

      // Fetch all data for the day
      const [siteMetrics, pageAnalytics, topData] = await Promise.all([
        this.fetchDailySiteMetrics(startDate, endDate),
        this.fetchPageAnalytics(startDate, endDate),
        this.fetchTopPagesAndSources(startDate, endDate),
      ]);

      // Store site metrics
      if (siteMetrics.length > 0) {
        const dayMetrics = siteMetrics[0];
        
        await prisma.siteMetrics.upsert({
          where: { date: startDate },
          create: {
            date: startDate,
            totalUsers: dayMetrics.totalUsers,
            newUsers: dayMetrics.newUsers,
            sessions: dayMetrics.sessions,
            pageViews: dayMetrics.pageViews,
            bounceRate: dayMetrics.bounceRate,
            avgSessionDuration: dayMetrics.avgSessionDuration,
            conversions: dayMetrics.conversions,
            topPages: topData.topPages,
            topSources: topData.topSources,
            deviceBreakdown: topData.deviceBreakdown,
          },
          update: {
            totalUsers: dayMetrics.totalUsers,
            newUsers: dayMetrics.newUsers,
            sessions: dayMetrics.sessions,
            pageViews: dayMetrics.pageViews,
            bounceRate: dayMetrics.bounceRate,
            avgSessionDuration: dayMetrics.avgSessionDuration,
            conversions: dayMetrics.conversions,
            topPages: topData.topPages,
            topSources: topData.topSources,
            deviceBreakdown: topData.deviceBreakdown,
          },
        });
      }

      // Store page analytics
      for (const pageData of pageAnalytics) {
        await prisma.pageView.upsert({
          where: {
            date_pagePath: {
              date: pageData.date,
              pagePath: pageData.pagePath,
            },
          },
          create: pageData,
          update: {
            sessions: pageData.sessions,
            users: pageData.users,
            pageViews: pageData.pageViews,
            bounceRate: pageData.bounceRate,
            avgSessionDuration: pageData.avgSessionDuration,
            source: pageData.source,
            medium: pageData.medium,
            country: pageData.country,
            city: pageData.city,
            deviceCategory: pageData.deviceCategory,
            browser: pageData.browser,
          },
        });
      }

      logger.info(`Successfully stored GA4 data for ${format(date, 'yyyy-MM-dd')}`);
    } catch (error) {
      logger.error('Error storing daily metrics:', error);
      throw error;
    }
  }

  async syncHistoricalData(days = 30) {
    const endDate = new Date();
    
    for (let i = 0; i < days; i++) {
      const date = subDays(endDate, i);
      await this.storeDailyMetrics(date);
      
      // Add delay to respect API rate limits
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

module.exports = new GoogleAnalyticsService();