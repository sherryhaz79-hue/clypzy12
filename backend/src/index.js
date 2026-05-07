require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const connectDB = require('./config/database');
const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');
const config = require('./config');
const { startClipRefreshScheduler } = require('./services/clipRefreshScheduler');

const app = express();

// Trust nginx / reverse proxy headers (required for rate limiter + correct req.ip)
app.set('trust proxy', config.trustProxy);

// Security middleware
app.use(helmet());
app.use(cors({ origin: config.corsOrigin }));
app.use(compression());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' }
});
app.use('/api/', limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api', routes);

//logo uploads
const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));


// Error handling
app.use(errorHandler);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// Connect to MongoDB and start server
const startServer = async () => {
  await connectDB();

  const PORT = config.port;
  app.listen(PORT, () => {
    console.log(`Clypzy Backend API running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    startClipRefreshScheduler();
  });
};

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

module.exports = app;
