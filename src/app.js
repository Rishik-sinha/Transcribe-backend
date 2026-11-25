const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const { env } = require('./config/env');
const apiRoutes = require('./routes');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// ----- Middleware -----
app.use(cors({ origin: env.FRONTEND_URL, credentials: true }));
app.use(express.json({ limit: '50mb' })); // room for base64 WAV audio uploads
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// ----- Health check (public) -----
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Translator API is running', timestamp: new Date().toISOString() });
});

// ----- API routes -----
app.use('/api', apiRoutes);

// ----- 404 handler -----
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ----- Global error handler -----
app.use(errorHandler);

module.exports = app;
