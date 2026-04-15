const express = require('express');
const env = require('../config/env');
const AdminFeedback = require('../models/AdminFeedback');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const items = await AdminFeedback.find().sort({ createdAt: -1 }).limit(20).lean();
    res.json({ items });
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    const digest = typeof req.body?.digest === 'string' ? req.body.digest.trim() : '';
    const scope = typeof req.body?.scope === 'string' ? req.body.scope : 'crawl-review';

    if (!note) {
      return res.status(400).json({
        ok: false,
        message: 'Feedback note is required.',
      });
    }

    const item = await AdminFeedback.create({
      region: env.CRAWL_REGION,
      scope,
      note,
      digest,
      metadata: {
        source: 'admin-local',
      },
    });

    res.status(201).json({
      ok: true,
      item,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
