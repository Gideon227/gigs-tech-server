// controllers/job.controller.js
const asyncHandler = require('../middleware/asyncHandler');
const jobService = require('../services/job.service');
const analyticsService = require('../services/analytics.service')

/**
 * @route   GET /api/v1/jobs
 * @desc    Get all jobs (with filtering, sorting, pagination)
 * @access  Public
 */
exports.getAllJobs = asyncHandler(async (req, res, next) => {
  const jobs = await jobService.getAllJobs(req.query);
  res.status(200).json({
    status: 'success',
    results: jobs.length,
    data: jobs,
  });
});

/**
 * @route   GET /api/v1/jobs/:id
 * @desc    Get single job by ID
 * @access  Public
 */
exports.getJob = asyncHandler(async (req, res, next) => {
  const job = await jobService.getJobById(req.params.id);
  if (!job) {
    const err = new Error('No job found with that ID');
    err.statusCode = 404;
    return next(err);
  }
  res.status(200).json({ status: 'success', data: job });
});


exports.getAllJobsLength = asyncHandler(async (res, req, next) => {
  const jobLength = await jobService.getJobsLength()
  res.status(200).json({ status: "success", data: jobLength })
})

/**
 * @route   PATCH /api/v1/jobs/:id/status
 * @desc    Update only the status field of a job
 * @access  Public (or Protected)
 */
exports.updateJobStatus = asyncHandler(async (req, res, next) => {
  const { status } = req.body;
  if (!status) {
    const err = new Error('Status is required');
    err.statusCode = 400;
    return next(err);
  }

  const updatedJob = await jobService.updateJobStatus(req.params.id, status);
  if (!updatedJob) {
    const err = new Error('No job found with that ID');
    err.statusCode = 404;
    return next(err);
  }

  res.status(200).json({
    status: 'success',
    data: updatedJob,
  });
});

/**
 * @route   PATCH /api/v1/jobs/:id
 * @desc    Update arbitrary fields of a job
 * @access  Public (or Protected)
 */
exports.updateJob = asyncHandler(async (req, res, next) => {
  const updatedJob = await jobService.updateJob(req.params.id, req.body);
  if (!updatedJob) {
    const err = new Error('No job found with that ID');
    err.statusCode = 404;
    return next(err);
  }
  res.status(200).json({
    status: 'success',
    data: updatedJob,
  });
});

/**
 * @route   DELETE /api/v1/jobs/:id
 * @desc    Delete a job
 * @access  Public (or Protected)
 */
exports.deleteJob = asyncHandler(async (req, res, next) => {
  const deletedJob = await jobService.deleteJob(req.params.id);
  if (!deletedJob) {
    const err = new Error('No job found with that ID');
    err.statusCode = 404;
    return next(err);
  }
  res.status(204).json({
    status: 'success',
    data: null,
  });
});

exports.getRelatedJobs = async (req, res) => {
  try {
    const jobId = req.params.id;
    const relatedJobs = await jobService.getRelatedJobs(jobId);
    res.status(200).json({ status: 'success', data: relatedJobs });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', message: error.message });
  }
};

//  Analytics Controller
/**
 * GET /api/v1/jobs/analytics
 * Returns job analytics for dashboard charts.
*/
exports.getJobAnalytics = async (req, res) => {
  try {
    const data = await analyticsService.getJobAnalytics();
    return res.status(200).json({ status: 'success', data: data })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ message: `${error.message} Failed to fetch job analytics` });
  }
}

// New analytics endpoints
exports.getDashboardAnalytics = async (req, res) => {
  try {
    const data = await analyticsService.getDashboardAnalytics();
    return res.status(200).json({ status: 'success', data });
  } catch (error) {
    console.error('Dashboard analytics error:', error);
    return res.status(500).json({ 
      status: 'error', 
      message: `Failed to fetch dashboard analytics: ${error.message}` 
    });
  }
};

exports.getTrafficSources = async (req, res) => {
  try {
    const data = await analyticsService.getTrafficSources();
    return res.status(200).json({ status: 'success', data });
  } catch (error) {
    console.error('Traffic sources error:', error);
    return res.status(500).json({ 
      status: 'error', 
      message: `Failed to fetch traffic sources: ${error.message}` 
    });
  }
};

exports.getGeographicData = async (req, res) => {
  try {
    const data = await analyticsService.getGeographicData();
    return res.status(200).json({ status: 'success', data });
  } catch (error) {
    console.error('Geographic data error:', error);
    return res.status(500).json({ 
      status: 'error', 
      message: `Failed to fetch geographic data: ${error.message}` 
    });
  }
};

// Manual sync endpoint (for testing/admin use)
exports.syncGoogleAnalytics = async (req, res) => {
  try {
    const { days = 1 } = req.query;
    const googleAnalytics = require('../services/googleAnalytics.service');
    
    if (days === 'historical') {
      await googleAnalytics.syncHistoricalData(30);
    } else {
      const { subDays } = require('date-fns');
      const targetDate = subDays(new Date(), parseInt(days));
      await googleAnalytics.storeDailyMetrics(targetDate);
    }
    
    return res.status(200).json({ 
      status: 'success', 
      message: 'Analytics sync completed' 
    });
  } catch (error) {
    console.error('Sync error:', error);
    return res.status(500).json({ 
      status: 'error', 
      message: `Sync failed: ${error.message}` 
    });
  }
};