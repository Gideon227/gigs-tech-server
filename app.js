// app.js
require('./config/config')
const express = require('express');
const morgan = require('morgan');
const helmet = require('helmet');
const cors = require('cors');
const jobRoutes = require('./routes/job.routes');
const notFoundHandler = require('./middleware/notFoundHandler');
const apiErrorHandler = require('./middleware/apiErrorHandler');
const logger = require('./config/logger');
const requestId = require('./middleware/requestId');


const app = express();

// GLOBAL MIDDLEWARE
app.use(helmet());                         // Security headers

const corsOptions = {
  origin: process.env.CORS_ORIGIN || '*',
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};

app.use(cors(corsOptions));

app.use(express.json({ limit: '30kb' }));  // Body parser for JSON
app.use(express.urlencoded({ extended: true }));

// HTTP request logger (morgan → Winston)
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}
app.use(requestId);

// ROUTES
app.use('/api/v1/jobs', jobRoutes);

// 404 Handler
app.use(notFoundHandler);

// GLOBAL ERROR HANDLER
app.use(apiErrorHandler);

module.exports = app;