const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const Offer = require('../models/Offer');
const { offersRateLimit, basketRateLimit, imageProxyRateLimit } = require('../middleware/rateLimits');
const { validateBasketQuery, validateRankingQuery } = require('../middleware/validators');
const { buildOfferRanking, buildBasketSuggestions } = require('../services/offers/offerRankingService');
const { buildTopDeals } = require('../services/offers/topDealsService');
const { buildImageRequestHeaders, normalizeImageUrl } = require('../services/images/imageUrl');
const { isOfferFreshForActiveUse } = require('../services/offers/offerFreshness');

const router = express.Router();

function isPrivateHostname(hostname) {
  const host = String(hostname || '').toLowerCase();

  return host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    /^169\.254\./.test(host);
}

function parseSafeImageUrl(value) {
  try {
    const normalized = normalizeImageUrl(value);
    const parsed = new URL(normalized);

    if (!['http:', 'https:'].includes(parsed.protocol) || isPrivateHostname(parsed.hostname)) {
      return null;
    }

    return parsed.toString();
  } catch (error) {
    return null;
  }
}

router.get('/ranking', offersRateLimit, validateRankingQuery, async (req, res, next) => {
  try {
    const query = req.validatedRankingQuery || req.query;
    const ranking = await buildOfferRanking({
      categories: query.categories || '',
      query: query.q || '',
      unit: query.unit || 'all',
      retailers: query.retailers || '',
      programRetailers: query.programRetailers || '',
      onlyWithoutProgram: query.onlyWithoutProgram || false,
      limit: query.limit || 30,
      offset: query.offset || 0,
      offsetExplicit: query.offsetExplicit === true,
      resultSetToken: query.resultSetToken || '',
      debugTiming: query.debugTiming === true,
    });

    res.json(ranking);
  } catch (error) {
    next(error);
  }
});

router.get('/basket', basketRateLimit, validateBasketQuery, async (req, res, next) => {
  try {
    const suggestions = await buildBasketSuggestions({
      items: req.query.items || '',
      categories: req.query.categories || '',
      retailers: req.query.retailers || '',
      programRetailers: req.query.programRetailers || '',
      onlyWithoutProgram: req.query.onlyWithoutProgram || false,
    });

    res.json(suggestions);
  } catch (error) {
    next(error);
  }
});

router.get('/top-deals', offersRateLimit, async (req, res, next) => {
  try {
    const topDeals = await buildTopDeals({
      limit: req.query.limit,
      category: req.query.category,
      retailer: req.query.retailer,
    });
    res.json(topDeals);
  } catch (error) {
    next(error);
  }
});

router.get('/:offerId/image', imageProxyRateLimit, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.offerId)) {
      return res.status(400).json({ ok: false, message: 'Invalid offer id.' });
    }

    const offer = await Offer.findById(req.params.offerId, {
      imageUrl: 1,
      title: 1,
      retailerName: 1,
      sourceUrl: 1,
      sourceUrls: 1,
      evidenceUrls: 1,
      sourceType: 1,
      sourceTypes: 1,
      status: 1,
      isActiveNow: 1,
      validTo: 1,
      lastSeenAt: 1,
      updatedAt: 1,
      createdAt: 1,
      lastSeenRunId: 1,
      lastSeenSourceRunId: 1,
      crawlJobId: 1,
      publishStatus: 1,
      sourceRunStatus: 1,
      conditionsText: 1,
      customerProgramRequired: 1,
      priceCurrent: 1,
      quantityText: 1,
      unitValue: 1,
      totalComparableAmount: 1,
      comparableUnit: 1,
      rawFacts: 1,
    }).lean();

    if (!offer || !isOfferFreshForActiveUse(offer)) {
      return res.status(404).json({ ok: false, message: 'Offer not found' });
    }

    if (!offer.imageUrl) {
      return res.status(404).json({ ok: false, message: 'Offer image not available' });
    }

    const imageUrl = parseSafeImageUrl(offer.imageUrl);

    if (!imageUrl) {
      return res.status(404).json({ ok: false, message: 'Offer image not available' });
    }

    const response = await axios.get(imageUrl, {
      responseType: 'stream',
      timeout: 10000,
      maxRedirects: 5,
      headers: buildImageRequestHeaders({ referer: offer.sourceUrl || '' }),
    });
    const contentType = String(response.headers['content-type'] || '').toLowerCase();

    if (!contentType.startsWith('image/')) {
      response.data.destroy();
      return res.status(502).json({ ok: false, message: 'Invalid image response.' });
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');

    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }

    response.data.on('error', next);
    response.data.pipe(res);
  } catch (error) {
    next(error);
  }
});

router.__private = {
  parseSafeImageUrl,
};

module.exports = router;
