// app.js
require('./config/config')
const express = require('express');
const morgan = require('morgan');
const helmet = require('helmet');
const cors = require('cors');
const jobRoutes = require('./routes/job.routes');
const contactRoutes = require('./routes/contact.routes')
const notFoundHandler = require('./middleware/notFoundHandler');
const apiErrorHandler = require('./middleware/apiErrorHandler');
const logger = require('./config/logger');
const requestId = require('./middleware/requestId');


const app = express();

// GLOBAL MIDDLEWARE
app.use(helmet());

const allowedOrigins = (process.env.CORS_ORIGIN || 'https://gigs.tech').split(',').map(o => o.trim());

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS blocked for origin: ${origin}`));
    }
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json({ limit: '30kb' }));  // Body parser for JSON
app.use(express.urlencoded({ extended: true }));

// HTTP request logger (morgan → Winston)
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}
app.use(requestId);

// ROUTES
app.use('/api/v1/jobs', jobRoutes);
app.use('/api/v1/contact', contactRoutes)

// 404 Handler
app.use(notFoundHandler);

// GLOBAL ERROR HANDLER
app.use(apiErrorHandler);

module.exports = app;