const express = require('express');
const axios = require('axios');
const Offer = require('../models/Offer');
const { buildOfferRanking, buildBasketSuggestions } = require('../services/offers/offerRankingService');

const router = express.Router();

router.get('/ranking', async (req, res, next) => {
  try {
    const ranking = await buildOfferRanking({
      categories: req.query.categories || '',
      query: req.query.q || '',
      unit: req.query.unit || 'all',
      retailers: req.query.retailers || '',
      programRetailers: req.query.programRetailers || '',
      onlyWithoutProgram: req.query.onlyWithoutProgram || false,
      limit: req.query.limit || 30,
    });

    res.json(ranking);
  } catch (error) {
    next(error);
  }
});

router.get('/basket', async (req, res, next) => {
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

router.get('/:offerId/image', async (req, res, next) => {
  try {
    const offer = await Offer.findById(req.params.offerId, { imageUrl: 1, title: 1, retailerName: 1 }).lean();

    if (!offer) {
      return res.status(404).json({ ok: false, message: 'Offer not found' });
    }

    if (!offer.imageUrl) {
      return res.status(404).json({ ok: false, message: 'Offer image not available' });
    }

    const response = await axios.get(offer.imageUrl, {
      responseType: 'stream',
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
    });

    res.setHeader('Content-Type', response.headers['content-type'] || 'image/jpeg');
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

module.exports = router;
