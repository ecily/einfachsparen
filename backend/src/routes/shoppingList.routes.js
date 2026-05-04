const express = require('express');
const env = require('../config/env');
const {
  createSharedShoppingList,
  getSharedShoppingList,
} = require('../services/shoppingLists/sharedShoppingListService');
const { shoppingListShareRateLimit } = require('../middleware/rateLimits');
const { validateShareId, validateSharePayload } = require('../middleware/validators');

const router = express.Router();

function buildShareUrl(shareId) {
  const origin = String(env.KAUFKLUG_PUBLIC_ORIGIN || 'https://www.kaufklug.at')
    .replace(/\/+$/, '')
    .replace('https://kaufklug.at', 'https://www.kaufklug.at');

  return `${origin}/liste/${shareId}`;
}

function serializeList(list) {
  return {
    shareId: list.shareId,
    source: list.source,
    version: list.version,
    createdAt: list.createdAt,
    expiresAt: list.expiresAt,
    items: list.items || [],
  };
}

router.post('/share', shoppingListShareRateLimit, validateSharePayload, async (req, res, next) => {
  try {
    const list = await createSharedShoppingList(req.body);

    res.status(201).json({
      shareId: list.shareId,
      url: buildShareUrl(list.shareId),
      expiresAt: list.expiresAt,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        ok: false,
        message: error.message,
      });
    }

    next(error);
  }
});

router.get('/share/:shareId', shoppingListShareRateLimit, validateShareId, async (req, res, next) => {
  try {
    const list = await getSharedShoppingList(req.params.shareId);

    if (!list) {
      return res.status(404).json({
        ok: false,
        message: 'Geteilte Einkaufsliste nicht gefunden oder abgelaufen.',
      });
    }

    res.setHeader('X-Robots-Tag', 'noindex, noarchive');
    res.json(serializeList(list));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
