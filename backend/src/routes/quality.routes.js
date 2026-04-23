const express = require('express');
const { buildQualitySnapshot } = require('../services/quality/qualityService');
const {
  upsertSubcategoryCategoryOverride,
  upsertArticleSubcategoryOverride,
} = require('../services/quality/manualCategoryOverrideService');

const router = express.Router();

router.get('/snapshot', async (req, res, next) => {
  try {
    const snapshot = await buildQualitySnapshot({
      query: req.query.q || '',
      retailerKey: req.query.retailerKey || '',
      categoryPrimary: req.query.categoryPrimary || '',
      categorySecondary: req.query.categorySecondary || '',
      limit: req.query.limit || 200,
    });

    res.json(snapshot);
  } catch (error) {
    next(error);
  }
});

router.post('/subcategory-category', async (req, res, next) => {
  try {
    const result = await upsertSubcategoryCategoryOverride({
      matchSubcategoryLabel: req.body?.matchSubcategoryLabel || '',
      targetCategoryPrimary: req.body?.targetCategoryPrimary || '',
      note: req.body?.note || '',
    });

    res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/article-subcategory', async (req, res, next) => {
  try {
    const result = await upsertArticleSubcategoryOverride({
      retailerKey: req.body?.retailerKey || '',
      titleNormalized: req.body?.titleNormalized || '',
      titleDisplay: req.body?.titleDisplay || '',
      targetCategoryPrimary: req.body?.targetCategoryPrimary || '',
      targetCategorySecondary: req.body?.targetCategorySecondary || '',
      note: req.body?.note || '',
    });

    res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
