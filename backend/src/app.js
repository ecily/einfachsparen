const express = require('express');
const cors = require('cors');
const env = require('./config/env');
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

const allowedOrigins = new Set([
  env.ADMIN_ORIGIN,
  env.KAUFKLUG_PUBLIC_ORIGIN,
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'https://kaufklug.at',
  'https://www.kaufklug.at',
]);

function addOrigin(origin) {
  if (typeof origin !== 'string' || !origin.trim()) {
    return;
  }

  allowedOrigins.add(origin.trim().replace(/\/+$/, ''));
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
addLocalhostVariant(env.ADMIN_ORIGIN);
addLocalhostVariant(env.KAUFKLUG_PUBLIC_ORIGIN);
addWwwVariant(env.KAUFKLUG_PUBLIC_ORIGIN);

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

app.use(express.json({ limit: '1mb' }));

app.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'einfachsparen-api',
  });
});

app.use('/api/health', healthRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/essence', essenceRoutes);
app.use('/api/sources', sourceRoutes);
app.use('/api/crawl', crawlRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/offers', offerRoutes);
app.use('/api/filters', filterRoutes);
app.use('/api/user-preferences', userPreferencesRoutes);
app.use('/api/quality', qualityRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/download', downloadRoutes);
app.use('/api/shopping-lists', shoppingListRoutes);

app.use((error, req, res, next) => {
  res.status(500).json({
    ok: false,
    message: error.message || 'Unexpected server error',
  });
});

module.exports = app;
