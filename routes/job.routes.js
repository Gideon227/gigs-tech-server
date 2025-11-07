// routes/job.routes.js
const express = require('express');
const router = express.Router();
const jobController = require('../controllers/job.controller');

router
  .route('/')
  .get(jobController.getAllJobs);

router
  .route('/:id')
  .get(jobController.getJob)
  .patch(jobController.updateJob)
  .delete(jobController.deleteJob);

router
  .route('/:id/related-jobs')
  .get( jobController.getRelatedJobs);

router
  .route('/admin/analytics')
  .get(jobController.getJobAnalytics);

router
  .route('/admin/analytics/users')
  .get(jobController.getGoogleAnalyticsData);

router
  .route('/admin/analytics/metrics')
  .get(jobController.metrics);

module.exports = router;
