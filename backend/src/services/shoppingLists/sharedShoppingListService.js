const crypto = require('node:crypto');
const SharedShoppingList = require('../../models/SharedShoppingList');

const SNAPSHOT_TTL_DAYS = 14;
const MAX_ITEMS = 120;
const MAX_TITLE_LENGTH = 180;
const MAX_SHORT_TEXT_LENGTH = 80;
const MAX_IMAGE_URL_LENGTH = 500;
const SHARE_ID_BYTES = 12;

function clampString(value, maxLength) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().slice(0, maxLength);
}

function sanitizeFinitePrice(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue) || numericValue < 0 || numericValue > 99999) {
    return null;
  }

  return Math.round(numericValue * 100) / 100;
}

function sanitizeDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function sanitizeImageUrl(value) {
  const imageUrl = clampString(value, MAX_IMAGE_URL_LENGTH);

  if (!imageUrl) {
    return '';
  }

  try {
    const parsed = new URL(imageUrl);

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return '';
    }

    return parsed.toString();
  } catch (error) {
    return '';
  }
}

function sanitizeItem(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const title = clampString(item.title, MAX_TITLE_LENGTH);

  if (!title) {
    return null;
  }

  const amount = sanitizeFinitePrice(item.priceCurrent?.amount ?? item.currentPrice?.amount ?? item.price);
  const currency = clampString(item.priceCurrent?.currency || item.currentPrice?.currency || 'EUR', 3).toUpperCase() || 'EUR';

  return {
    offerId: clampString(item.offerId, MAX_SHORT_TEXT_LENGTH),
    retailerKey: clampString(item.retailerKey || item.providerKey, MAX_SHORT_TEXT_LENGTH),
    retailerName: clampString(item.retailerName || item.retailer || item.provider, MAX_SHORT_TEXT_LENGTH) || 'Unbekannter Markt',
    title,
    categoryLabel: clampString(item.categoryLabel, MAX_SHORT_TEXT_LENGTH),
    priceCurrent: {
      amount,
      currency,
    },
    unit: clampString(item.unit || item.normalizedUnitPrice?.unit, MAX_SHORT_TEXT_LENGTH),
    quantityText: clampString(item.quantityText || item.quantity, MAX_SHORT_TEXT_LENGTH),
    validUntil: sanitizeDate(item.validUntil || item.validTo),
    imageUrl: sanitizeImageUrl(item.imageUrl),
  };
}

function sanitizeSnapshotItems(payload) {
  const rawItems = Array.isArray(payload?.items) ? payload.items : [];

  return rawItems.slice(0, MAX_ITEMS).map(sanitizeItem).filter(Boolean);
}

function createShareId() {
  return crypto.randomBytes(SHARE_ID_BYTES).toString('base64url');
}

function buildExpiresAt(now = new Date()) {
  return new Date(now.getTime() + SNAPSHOT_TTL_DAYS * 24 * 60 * 60 * 1000);
}

async function createSharedShoppingList(payload) {
  const items = sanitizeSnapshotItems(payload);

  if (!items.length) {
    const error = new Error('Die Einkaufsliste enthält keine teilbaren Einträge.');
    error.statusCode = 400;
    throw error;
  }

  const expiresAt = buildExpiresAt();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await SharedShoppingList.create({
        shareId: createShareId(),
        items,
        source: 'shopping-list',
        version: 1,
        expiresAt,
      });
    } catch (error) {
      if (error?.code !== 11000 || attempt === 2) {
        throw error;
      }
    }
  }

  throw new Error('Share-ID konnte nicht erzeugt werden.');
}

async function getSharedShoppingList(shareId) {
  const normalizedShareId = clampString(shareId, 64);

  if (!normalizedShareId || !/^[A-Za-z0-9_-]{12,64}$/.test(normalizedShareId)) {
    return null;
  }

  const list = await SharedShoppingList.findOne({
    shareId: normalizedShareId,
    expiresAt: { $gt: new Date() },
  }).lean();

  return list;
}

module.exports = {
  MAX_ITEMS,
  SNAPSHOT_TTL_DAYS,
  createSharedShoppingList,
  getSharedShoppingList,
  sanitizeSnapshotItems,
};
