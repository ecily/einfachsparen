const express = require('express');
const { getRetailerFilters, getCategoryFilters } = require('../services/filters/filterMetadataService');

const router = express.Router();

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }

  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

router.get('/retailers', async (req, res, next) => {
  try {
    const retailers = await getRetailerFilters();

    res.json({
      generatedAt: new Date().toISOString(),
      retailers,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/categories', async (req, res, next) => {
  try {
    const retailerKeys = normalizeStringList(req.query.retailers);
    const categories = await getCategoryFilters({ retailerKeys });

    res.json({
      generatedAt: new Date().toISOString(),
      filters: {
        retailers: retailerKeys,
      },
      categories,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
