const express = require('express');
const Source = require('../models/Source');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const sources = await Source.find().sort({ retailerName: 1 }).lean();
    res.json({ items: sources });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
