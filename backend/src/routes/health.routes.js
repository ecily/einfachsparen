const express = require('express');
const env = require('../config/env');
const { getDatabaseState } = require('../config/mongodb');

const router = express.Router();

router.get('/', (req, res) => {
  const db = getDatabaseState();

  res.json({
    ok: true,
    app: 'einfachsparen-backend',
    environment: env.NODE_ENV,
    region: env.CRAWL_REGION,
    database: {
      connected: db.readyState === 1,
      name: db.name,
      host: db.host,
      models: db.models,
    },
    now: new Date().toISOString(),
  });
});

module.exports = router;
