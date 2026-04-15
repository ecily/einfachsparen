const express = require('express');
const { buildLatestEssenceDigest } = require('../services/dashboard/essenceService');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const digest = await buildLatestEssenceDigest();
    res.json({ digest });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
