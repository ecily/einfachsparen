const express = require('express');
const cors = require('cors');
const env = require('./config/env');
const logger = require('./lib/logger');
const { requireAdminApiKey } = require('./middleware/adminAuth');
const { globalRateLimit } = require('./middleware/rateLimits');
const { validatePublicPayloadSize } = require('./middleware/validators');
const healthRoutes = require('./routes/health.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const sourceRoutes = require('./routes/source.routes');
const crawlRoutes = require('./routes/crawl.routes');
const essenceRoutes = require('./routes/essence.routes');
const feedbackRoutes = require('./routes/feedback.routes');
const offerRoutes = require('./routes/offer.routes');
const filterRoutes = require('./routes/filter.routes');
const userPreferencesRoutes = require('./routes/userPreferences.routes');
const qualityRoutes = require('./routes/quality.routes');
const analyticsRoutes = require('./routes/analytics.routes');
const downloadRoutes = require('./routes/download.routes');
const shoppingListRoutes = require('./routes/shoppingList.routes');

const app = express();

if (env.NODE_ENV === 'production') {
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
}

const allowedOrigins = new Set([
  'https://kaufklug.at',
  'https://www.kaufklug.at',
]);

if (env.NODE_ENV !== 'production') {
  [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
  ].forEach((origin) => allowedOrigins.add(origin));
}

function isLocalOrigin(origin) {
  try {
    const originUrl = new URL(origin);
    return originUrl.hostname === 'localhost' || originUrl.hostname === '127.0.0.1';
  } catch (error) {
    return false;
  }
}

function addOrigin(origin) {
  if (typeof origin !== 'string' || !origin.trim()) {
    return;
  }

  const normalizedOrigin = origin.trim().replace(/\/+$/, '');

  if (env.NODE_ENV === 'production' && isLocalOrigin(normalizedOrigin)) {
    return;
  }

  allowedOrigins.add(normalizedOrigin);
}

function addWwwVariant(origin) {
  try {
    const originUrl = new URL(origin);
    const normalizedOrigin = originUrl.origin;

    addOrigin(normalizedOrigin);

    if (originUrl.hostname === 'kaufklug.at') {
      originUrl.hostname = 'www.kaufklug.at';
      addOrigin(originUrl.origin);
      return;
    }

    if (originUrl.hostname === 'www.kaufklug.at') {
      originUrl.hostname = 'kaufklug.at';
      addOrigin(originUrl.origin);
    }
  } catch (error) {
    // Ignore URL expansion and fall back to the configured origin only.
  }
}

function addLocalhostVariant(origin) {
  try {
    const originUrl = new URL(origin);
    const normalizedOrigin = originUrl.origin;

    addOrigin(normalizedOrigin);

    if (originUrl.hostname === 'localhost') {
      addOrigin(`${originUrl.protocol}//127.0.0.1:${originUrl.port}`);
    }

    if (originUrl.hostname === '127.0.0.1') {
      addOrigin(`${originUrl.protocol}//localhost:${originUrl.port}`);
    }
  } catch (error) {
    // Ignore URL expansion and fall back to the configured origin only.
  }
}

addOrigin(env.ADMIN_ORIGIN);
addOrigin(env.KAUFKLUG_PUBLIC_ORIGIN);
addWwwVariant(env.KAUFKLUG_PUBLIC_ORIGIN);

if (env.NODE_ENV !== 'production') {
  addLocalhostVariant(env.ADMIN_ORIGIN);
  addLocalhostVariant(env.KAUFKLUG_PUBLIC_ORIGIN);
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }

      const normalizedOrigin = String(origin).replace(/\/+$/, '');

      if (allowedOrigins.has(normalizedOrigin)) {
        return callback(null, true);
      }

      return callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
  })
);

app.use(globalRateLimit);
app.use(validatePublicPayloadSize);
app.use(express.json({ limit: '1mb' }));

app.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'einfachsparen-api',
  });
});

app.use('/api/health', healthRoutes);
app.use('/api/dashboard', requireAdminApiKey, dashboardRoutes);
app.use('/api/essence', requireAdminApiKey, essenceRoutes);
app.use('/api/sources', requireAdminApiKey, sourceRoutes);
app.use('/api/crawl', requireAdminApiKey, crawlRoutes);
app.get('/api/feedback', requireAdminApiKey);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/offers', offerRoutes);
app.use('/api/filters', filterRoutes);
app.use('/api/user-preferences', userPreferencesRoutes);
app.use('/api/quality', requireAdminApiKey, qualityRoutes);
app.get('/api/analytics/summary', requireAdminApiKey);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/download', downloadRoutes);
app.use('/api/shopping-lists', shoppingListRoutes);

app.use((error, req, res, next) => {
  const statusCode = Number(error.statusCode || error.status || 500);
  const safeStatusCode = statusCode >= 400 && statusCode < 600 ? statusCode : 500;
  const isServerError = safeStatusCode >= 500;
  const exposeMessage = !isServerError || env.NODE_ENV !== 'production';

  logger.error('Request failed', {
    method: req.method,
    path: req.originalUrl,
    statusCode: safeStatusCode,
    message: error.message,
    stack: env.NODE_ENV === 'production' ? undefined : error.stack,
  });

  res.status(safeStatusCode).json({
    ok: false,
    message: exposeMessage ? error.message || 'Unerwarteter Serverfehler.' : 'Unerwarteter Serverfehler.',
  });
});

module.exports = app;
