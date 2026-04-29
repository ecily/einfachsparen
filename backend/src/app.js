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

const app = express();
const allowedOrigins = new Set([env.ADMIN_ORIGIN, env.KAUFKLUG_PUBLIC_ORIGIN]);

function addLocalhostVariant(origin) {
  try {
    const originUrl = new URL(origin);

    if (originUrl.hostname === 'localhost') {
      allowedOrigins.add(`${originUrl.protocol}//127.0.0.1:${originUrl.port}`);
    }

    if (originUrl.hostname === '127.0.0.1') {
      allowedOrigins.add(`${originUrl.protocol}//localhost:${originUrl.port}`);
    }
  } catch (error) {
    // Ignore URL expansion and fall back to the configured origin only.
  }
}

addLocalhostVariant(env.ADMIN_ORIGIN);
addLocalhostVariant(env.KAUFKLUG_PUBLIC_ORIGIN);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
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

app.use((error, req, res, next) => {
  res.status(500).json({
    ok: false,
    message: error.message || 'Unexpected server error',
  });
});

module.exports = app;
