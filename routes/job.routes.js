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

// router
//   .route('/:id/status')
//   .patch(jobController.updateJobStatus);

router
  .route('/:id/related-jobs')
  .get( jobController.getRelatedJobs);

router
  .route('/admin/analytics')
  .get(jobController.getJobAnalytics)

// router
//   .route('/analytics/dashboard')
//   .get(jobController.getDashboardAnalytics)

// router
//   .route('/analytics/geographic')
//   .get(jobController.getGeographicData)

// router
//   .route('/analytics/traffic-sources')
//   .get(jobController.getTrafficSources)

// router
//   .route('/analytics/sync')
//   .get(jobController.syncGoogleAnalytics)


module.exports = router;
