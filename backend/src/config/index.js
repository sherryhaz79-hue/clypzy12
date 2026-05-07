const path = require('path');

const parseTrustProxy = (value) => {
  if (value === undefined || value === null || value === '') return 1;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return 1;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  return value;
};

module.exports = {
  mongoURI: process.env.MONGODB_URI || 'mongodb://localhost:27017/diro',
  jwtSecret: process.env.JWT_SECRET || 'default-secret-key-change-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS) || 10,
  port: process.env.PORT || 3000,
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  logLevel: process.env.LOG_LEVEL || 'info',
  stripe: {
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET
  },
  paypal: {
    clientId: process.env.PAYPAL_CLIENT_ID,
    clientSecret: process.env.PAYPAL_CLIENT_SECRET,
    mode: process.env.PAYPAL_MODE || 'sandbox'
  },
  oauth: {
    instagram: {
      clientId: process.env.OAUTH_INSTAGRAM_CLIENT_ID,
      clientSecret: process.env.OAUTH_INSTAGRAM_CLIENT_SECRET,
      redirectUri: process.env.OAUTH_INSTAGRAM_REDIRECT_URI || 'http://localhost:3000/auth/instagram/callback'
    },
    tiktok: {
      clientId: process.env.OAUTH_TIKTOK_CLIENT_ID,
      clientSecret: process.env.OAUTH_TIKTOK_CLIENT_SECRET,
      redirectUri: process.env.OAUTH_TIKTOK_REDIRECT_URI || 'http://localhost:3000/auth/tiktok/callback'
    },
    youtube: {
      clientId: process.env.OAUTH_YOUTUBE_CLIENT_ID,
      clientSecret: process.env.OAUTH_YOUTUBE_CLIENT_SECRET,
      redirectUri: process.env.OAUTH_YOUTUBE_REDIRECT_URI || 'http://localhost:3000/auth/youtube/callback'
    }
  },
  instagramGraph: {
    enabled: process.env.INSTAGRAM_GRAPH_ENABLED !== 'false',
    docId: process.env.INSTAGRAM_GRAPH_DOC_ID || '8845758582119845',
    cacheTtlMs: Number.isFinite(Number(process.env.INSTAGRAM_GRAPH_CACHE_TTL_MS))
      ? Number(process.env.INSTAGRAM_GRAPH_CACHE_TTL_MS)
      : 10 * 60 * 1000,
    requestTimeoutMs: Number.isFinite(Number(process.env.INSTAGRAM_GRAPH_REQUEST_TIMEOUT_MS))
      ? Number(process.env.INSTAGRAM_GRAPH_REQUEST_TIMEOUT_MS)
      : 12000,
    cookiesFile: process.env.INSTAGRAM_GRAPH_COOKIES_FILE || path.resolve(__dirname, '../../cookies.json')
  },
  youtubeSr: {
    enabled: process.env.YOUTUBE_SR_ENABLED !== 'false',
    cacheTtlMs: Number.isFinite(Number(process.env.YOUTUBE_SR_CACHE_TTL_MS))
      ? Number(process.env.YOUTUBE_SR_CACHE_TTL_MS)
      : 10 * 60 * 1000,
    apiKey: process.env.YOUTUBE_DATA_API_KEY || 'AIzaSyBZWdaeD_KyO3j08w8RUtQ6pwJwVWf1Lcw'
  },
  externalMetrics: {
    globalWindowMs: Number.isFinite(Number(process.env.EXTERNAL_METRICS_WINDOW_MS))
      ? Number(process.env.EXTERNAL_METRICS_WINDOW_MS)
      : 20 * 60 * 1000,
    maxRequestsPerWindow: Number.isFinite(Number(process.env.EXTERNAL_METRICS_MAX_REQUESTS_PER_WINDOW))
      ? Number(process.env.EXTERNAL_METRICS_MAX_REQUESTS_PER_WINDOW)
      : 100,
    onDemandWindowMs: Number.isFinite(Number(process.env.EXTERNAL_METRICS_ON_DEMAND_WINDOW_MS))
      ? Number(process.env.EXTERNAL_METRICS_ON_DEMAND_WINDOW_MS)
      : 60 * 1000,
    onDemandMaxRequestsPerWindow: Number.isFinite(Number(process.env.EXTERNAL_METRICS_ON_DEMAND_MAX_REQUESTS_PER_WINDOW))
      ? Number(process.env.EXTERNAL_METRICS_ON_DEMAND_MAX_REQUESTS_PER_WINDOW)
      : 5,
    onDemandClipRefreshLimit: Number.isFinite(Number(process.env.EXTERNAL_METRICS_ON_DEMAND_CLIP_LIMIT))
      ? Number(process.env.EXTERNAL_METRICS_ON_DEMAND_CLIP_LIMIT)
      : 5,
    failureCooldownMs: Number.isFinite(Number(process.env.EXTERNAL_METRICS_FAILURE_COOLDOWN_MS))
      ? Number(process.env.EXTERNAL_METRICS_FAILURE_COOLDOWN_MS)
      : 30000,
    schedulerBatchSize: Number.isFinite(Number(process.env.EXTERNAL_METRICS_SCHEDULER_BATCH_SIZE))
      ? Number(process.env.EXTERNAL_METRICS_SCHEDULER_BATCH_SIZE)
      : 50,
    maxConcurrentRefreshes: Number.isFinite(Number(process.env.EXTERNAL_METRICS_MAX_CONCURRENT_REFRESHES))
      ? Number(process.env.EXTERNAL_METRICS_MAX_CONCURRENT_REFRESHES)
      : 1
  },
  payments: {
    autoComplete: process.env.PAYMENTS_AUTO_COMPLETE !== 'false'
  },
  backgroundJobs: {
    enabled: process.env.BACKGROUND_JOBS_ENABLED !== 'false',
    clipRefreshIntervalMs: Number.isFinite(Number(process.env.CLIP_REFRESH_INTERVAL_MS))
      ? Number(process.env.CLIP_REFRESH_INTERVAL_MS)
      : 10 * 60 * 1000
  }
};
