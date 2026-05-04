const express = require('express');
const env = require('../config/env');
const { getDatabaseState } = require('../config/mongodb');

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
    app: 'kaufklug-backend',
    environment: env.NODE_ENV,
    region: env.CRAWL_REGION,
    database,
    now: new Date().toISOString(),
  });
});

module.exports = router;
