const express = require('express');
const { buildQualitySnapshot } = require('../services/quality/qualityService');
const {
  buildProductionSparSourceMatchingDiagnostic,
} = require('../services/diagnostics/sparSourceMatchingDiagnosticRunner');
const {
  upsertSubcategoryCategoryOverride,
  upsertArticleSubcategoryOverride,
  ignoreArticleOffer,
} = require('../services/quality/manualCategoryOverrideService');

function createQualityRouter({
  qualityServiceImpl = { buildQualitySnapshot },
  manualCategoryOverrideServiceImpl = {
    upsertSubcategoryCategoryOverride,
    upsertArticleSubcategoryOverride,
    ignoreArticleOffer,
  },
  sparMatchingDiagnosticServiceImpl = {
    buildProductionSparSourceMatchingDiagnostic,
  },
} = {}) {
  const router = express.Router();

  router.get('/snapshot', async (req, res, next) => {
    try {
      const snapshot = await qualityServiceImpl.buildQualitySnapshot({
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

  router.get('/spar-source-matching-diagnostic', async (req, res, next) => {
    try {
      const report = await sparMatchingDiagnosticServiceImpl.buildProductionSparSourceMatchingDiagnostic({
        query: req.query || {},
      });

      res.json(report);
    } catch (error) {
      next(error);
    }
  });

  router.post('/subcategory-category', async (req, res, next) => {
    try {
      const result = await manualCategoryOverrideServiceImpl.upsertSubcategoryCategoryOverride({
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
      const result = await manualCategoryOverrideServiceImpl.upsertArticleSubcategoryOverride({
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

  router.post('/article-ignore', async (req, res, next) => {
    try {
      const result = await manualCategoryOverrideServiceImpl.ignoreArticleOffer({
        retailerKey: req.body?.retailerKey || '',
        titleNormalized: req.body?.titleNormalized || '',
        titleDisplay: req.body?.titleDisplay || '',
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

  return router;
}

const router = createQualityRouter();

module.exports = router;
module.exports.createQualityRouter = createQualityRouter;
