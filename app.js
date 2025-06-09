// app.js
const express = require('express');
const morgan = require('morgan');
const helmet = require('helmet');
const cors = require('cors');
const jobRoutes = require('./routes/job.routes');
const notFoundHandler = require('./middleware/notFoundHandler');
const apiErrorHandler = require('./middleware/apiErrorHandler');
const logger = require('./config/logger');
require('./config/config')

const app = express();

// GLOBAL MIDDLEWARE
app.use(helmet());                         // Security headers
app.use(cors());                           // Enable CORS (restrict origins in production if needed)
app.use(express.json({ limit: '10kb' }));  // Body parser for JSON
app.use(express.urlencoded({ extended: true }));

// HTTP request logger (morgan → Winston)
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// ROUTES
app.use('/api/v1/jobs', jobRoutes);

// 404 Handler
app.use(notFoundHandler);

// GLOBAL ERROR HANDLER
app.use(apiErrorHandler);

module.exports = app;
