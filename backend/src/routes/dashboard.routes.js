const express = require('express');
const { buildDashboardSnapshot } = require('../services/dashboard/dashboardService');

const router = express.Router();

router.get('/snapshot', async (req, res, next) => {
  try {
    const snapshot = await buildDashboardSnapshot();
    res.json(snapshot);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
