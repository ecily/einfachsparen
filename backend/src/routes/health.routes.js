const express = require('express');
const env = require('../config/env');
const { getDatabaseState } = require('../config/mongodb');
const { buildSafeBuildInfo } = require('../services/buildInfo');

const router = express.Router();

router.get('/', (req, res) => {
  const db = getDatabaseState();
  const database = env.NODE_ENV === 'production'
    ? {
        connected: db.readyState === 1,
      }
    : {
        connected: db.readyState === 1,
        name: db.name,
        host: db.host,
        models: db.models,
      };

  res.json({
    ok: true,
    status: 'ok',
    database,
    build: buildSafeBuildInfo(),
    now: new Date().toISOString(),
    ...(env.NODE_ENV === 'production'
      ? {}
      : {
          app: 'kaufklug-backend',
          environment: env.NODE_ENV,
          region: env.CRAWL_REGION,
        }),
  });
});

module.exports = router;
