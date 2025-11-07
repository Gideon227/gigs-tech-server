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
    // Allow requests with no origin (like mobile apps, Postman, or server-to-server)
    if (!origin) {
      return callback(null, true);
    }
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn(`CORS blocked for origin: ${origin}`);
      callback(new Error(`CORS policy does not allow access from origin: ${origin}`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  exposedHeaders: ['X-Request-ID'],
  maxAge: 86400, // 24 hours
};

app.use(cors(corsOptions));
// app.options('*', cors(corsOptions)); // Enable pre-flight for all routes

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