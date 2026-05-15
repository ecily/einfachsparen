const MAX_RANKING_LIMIT = 60;
const MAX_RANKING_OFFSET = 5000;
const MAX_QUERY_LENGTH = 80;
const MAX_LIST_VALUE_LENGTH = 60;
const MAX_LIST_VALUES = 20;
const MAX_RANKING_CATEGORY_VALUES = 80;
const MAX_RANKING_RETAILER_VALUES = 30;
const MAX_RANKING_CATEGORIES_LENGTH = 5000;
const MAX_RANKING_RETAILERS_LENGTH = 1500;
const MAX_UNIT_LENGTH = 20;
const MAX_BASKET_ITEMS = 20;
const MAX_BASKET_ITEM_LENGTH = 80;
const MAX_SHARE_ITEMS = 120;
const MAX_FEEDBACK_NOTE_LENGTH = 4000;
const MAX_FEEDBACK_DIGEST_LENGTH = 12000;
const MAX_FEEDBACK_METADATA_LENGTH = 2000;
const MAX_ANALYTICS_METADATA_LENGTH = 2000;
const MAX_PUBLIC_PAYLOAD_BYTES = {
  '/api/analytics/event': 16 * 1024,
  '/api/feedback': 32 * 1024,
  '/api/shopping-lists/share': 128 * 1024,
};

const allowedFeedbackScopes = new Set(['crawl-review', 'offer-review', 'general']);
const allowedSortValues = new Set(['', 'default', 'price', 'savings', 'retailer', 'validTo']);

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function rejectBadRequest(message) {
  throw createHttpError(400, message);
}

function getBodySize(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value || {}), 'utf8');
  } catch (error) {
    return Infinity;
  }
}

function requirePlainBody(req) {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    rejectBadRequest('Payload ist ungueltig.');
  }
}

function normalizeString(value, { maxLength, field, required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) {
      rejectBadRequest(`${field} ist erforderlich.`);
    }

    return '';
  }

  if (typeof value !== 'string') {
    rejectBadRequest(`${field} muss ein Text sein.`);
  }

  const trimmed = value.trim();

  if (trimmed.length > maxLength) {
    rejectBadRequest(`${field} ist zu lang.`);
  }

  if (required && !trimmed) {
    rejectBadRequest(`${field} ist erforderlich.`);
  }

  return trimmed;
}

function normalizeStringList(
  value,
  {
    field,
    maxValues = MAX_LIST_VALUES,
    maxLength = MAX_LIST_VALUE_LENGTH,
    maxTotalLength = maxValues * (maxLength + 1),
  } = {}
) {
  const rawValue = Array.isArray(value) ? value.join(',') : String(value || '');

  if (rawValue.length > maxTotalLength) {
    rejectBadRequest(`${field} ist zu lang.`);
  }

  const rawItems = Array.isArray(value) ? value : String(value || '').split(',');
  const items = rawItems.map((item) => String(item || '').trim()).filter(Boolean);

  if (items.length > maxValues) {
    rejectBadRequest(`${field} enthaelt zu viele Werte.`);
  }

  for (const item of items) {
    if (item.length > maxLength) {
      rejectBadRequest(`${field} enthaelt zu lange Werte.`);
    }
  }

  return items.join(',');
}

function normalizeFlexibleStringList(
  value,
  {
    field,
    maxValues = MAX_LIST_VALUES,
    maxLength = MAX_LIST_VALUE_LENGTH,
    maxTotalLength = maxValues * (maxLength + 1),
  } = {}
) {
  const rawValue = Array.isArray(value) ? value.join(',') : String(value || '');

  if (rawValue.length > maxTotalLength) {
    rejectBadRequest(`${field} ist zu lang.`);
  }

  let rawItems = Array.isArray(value) ? value : [value];

  if (!Array.isArray(value)) {
    const trimmed = String(value || '').trim();

    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);

        if (Array.isArray(parsed)) {
          rawItems = parsed;
        }
      } catch (error) {
        rawItems = [value];
      }
    } else {
      rawItems = String(value || '').split(',');
    }
  }

  const items = rawItems.map((item) => String(item || '').trim()).filter(Boolean);

  if (items.length > maxValues) {
    rejectBadRequest(`${field} enthaelt zu viele Werte.`);
  }

  for (const item of items) {
    if (item.length > maxLength) {
      rejectBadRequest(`${field} enthaelt zu lange Werte.`);
    }
  }

  if (Array.isArray(value)) {
    return items;
  }

  return String(value || '').trim();
}

function normalizeBooleanString(value) {
  return value === true || value === 'true' || value === '1' || value === 1;
}

function validatePublicPayloadSize(req, res, next) {
  const matchedPath = Object.keys(MAX_PUBLIC_PAYLOAD_BYTES).find((path) => req.path === path);

  if (!matchedPath) {
    return next();
  }

  const contentLength = Number(req.get('content-length') || 0);
  const maxBytes = MAX_PUBLIC_PAYLOAD_BYTES[matchedPath];

  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return next(createHttpError(413, 'Payload ist zu gross.'));
  }

  return next();
}

function validateRankingQuery(req, res, next) {
  try {
    const hasExplicitOffset = Object.prototype.hasOwnProperty.call(req.query, 'offset');
    const rawLimit = String(req.query.limit || '30').trim().toLowerCase();

    if (rawLimit === 'all') {
      rejectBadRequest('limit=all ist oeffentlich nicht erlaubt.');
    }

    const parsedLimit = Number(rawLimit);

    if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
      rejectBadRequest('limit ist ungueltig.');
    }

    req.query.limit = Math.min(parsedLimit, MAX_RANKING_LIMIT);
    const rawOffset = String(req.query.offset || '0').trim();
    const parsedOffset = Number(rawOffset);

    if (!Number.isInteger(parsedOffset) || parsedOffset < 0 || parsedOffset > MAX_RANKING_OFFSET) {
      rejectBadRequest('offset ist ungueltig.');
    }

    req.query.offset = parsedOffset;
    req.query.offsetExplicit = hasExplicitOffset;
    req.query.q = normalizeString(req.query.q || '', { field: 'q', maxLength: MAX_QUERY_LENGTH });
    req.query.categories = normalizeFlexibleStringList(req.query.categories, {
      field: 'categories',
      maxValues: MAX_RANKING_CATEGORY_VALUES,
      maxLength: MAX_LIST_VALUE_LENGTH,
      maxTotalLength: MAX_RANKING_CATEGORIES_LENGTH,
    });
    req.query.retailers = normalizeStringList(req.query.retailers, {
      field: 'retailers',
      maxValues: MAX_RANKING_RETAILER_VALUES,
      maxLength: MAX_LIST_VALUE_LENGTH,
      maxTotalLength: MAX_RANKING_RETAILERS_LENGTH,
    });
    req.query.programRetailers = normalizeStringList(req.query.programRetailers, {
      field: 'programRetailers',
      maxValues: MAX_RANKING_RETAILER_VALUES,
      maxLength: MAX_LIST_VALUE_LENGTH,
      maxTotalLength: MAX_RANKING_RETAILERS_LENGTH,
    });
    req.query.unit = normalizeString(req.query.unit || 'all', { field: 'unit', maxLength: MAX_UNIT_LENGTH }) || 'all';

    const sort = normalizeString(req.query.sort || '', { field: 'sort', maxLength: 20 });
    if (!allowedSortValues.has(sort)) {
      rejectBadRequest('sort ist ungueltig.');
    }

    req.query.sort = sort;
    req.query.onlyWithoutProgram = normalizeBooleanString(req.query.onlyWithoutProgram);
    return next();
  } catch (error) {
    return next(error);
  }
}

function validateBasketQuery(req, res, next) {
  try {
    const items = String(req.query.items || '')
      .split(/\r?\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);

    if (items.length > MAX_BASKET_ITEMS) {
      rejectBadRequest('items enthaelt zu viele Werte.');
    }

    for (const item of items) {
      if (item.length > MAX_BASKET_ITEM_LENGTH) {
        rejectBadRequest('items enthaelt zu lange Werte.');
      }
    }

    req.query.items = items.join(',');
    req.query.categories = normalizeStringList(req.query.categories, { field: 'categories' });
    req.query.retailers = normalizeStringList(req.query.retailers, { field: 'retailers' });
    req.query.programRetailers = normalizeStringList(req.query.programRetailers, { field: 'programRetailers' });
    req.query.onlyWithoutProgram = normalizeBooleanString(req.query.onlyWithoutProgram);
    return next();
  } catch (error) {
    return next(error);
  }
}

function validateCategoryFilterQuery(req, res, next) {
  try {
    req.query.retailers = normalizeStringList(req.query.retailers, { field: 'retailers' });
    return next();
  } catch (error) {
    return next(error);
  }
}

function validateSharePayload(req, res, next) {
  try {
    requirePlainBody(req);
    const items = Array.isArray(req.body?.items) ? req.body.items : null;

    if (!items) {
      rejectBadRequest('items ist erforderlich.');
    }

    if (items.length > MAX_SHARE_ITEMS) {
      rejectBadRequest('items enthaelt zu viele Eintraege.');
    }

    if (getBodySize(req.body) > MAX_PUBLIC_PAYLOAD_BYTES['/api/shopping-lists/share']) {
      throw createHttpError(413, 'Payload ist zu gross.');
    }

    return next();
  } catch (error) {
    return next(error);
  }
}

function validateShareId(req, res, next) {
  const shareId = String(req.params.shareId || '').trim();

  if (!/^[A-Za-z0-9_-]{12,64}$/.test(shareId)) {
    return res.status(404).json({
      ok: false,
      message: 'Geteilte Einkaufsliste nicht gefunden oder abgelaufen.',
    });
  }

  req.params.shareId = shareId;
  return next();
}

function validateFeedbackPayload(req, res, next) {
  try {
    requirePlainBody(req);

    if (getBodySize(req.body) > MAX_PUBLIC_PAYLOAD_BYTES['/api/feedback']) {
      throw createHttpError(413, 'Payload ist zu gross.');
    }

    req.body.note = normalizeString(req.body?.note, {
      field: 'note',
      maxLength: MAX_FEEDBACK_NOTE_LENGTH,
      required: true,
    });
    req.body.digest = normalizeString(req.body?.digest || '', {
      field: 'digest',
      maxLength: MAX_FEEDBACK_DIGEST_LENGTH,
    });
    req.body.scope = normalizeString(req.body?.scope || 'crawl-review', {
      field: 'scope',
      maxLength: 40,
    }) || 'crawl-review';

    if (!allowedFeedbackScopes.has(req.body.scope)) {
      rejectBadRequest('scope ist ungueltig.');
    }

    if (req.body.metadata !== undefined && getBodySize(req.body.metadata) > MAX_FEEDBACK_METADATA_LENGTH) {
      rejectBadRequest('metadata ist zu gross.');
    }

    return next();
  } catch (error) {
    return next(error);
  }
}

function validateAnalyticsPayload(req, res, next) {
  try {
    requirePlainBody(req);

    if (getBodySize(req.body) > MAX_PUBLIC_PAYLOAD_BYTES['/api/analytics/event']) {
      throw createHttpError(413, 'Payload ist zu gross.');
    }

    req.body.eventName = normalizeString(req.body?.eventName, {
      field: 'eventName',
      maxLength: 80,
      required: true,
    });
    req.body.path = normalizeString(req.body?.path || '/', {
      field: 'path',
      maxLength: 220,
    }) || '/';

    if (req.body.metadata !== undefined && (typeof req.body.metadata !== 'object' || Array.isArray(req.body.metadata))) {
      rejectBadRequest('metadata ist ungueltig.');
    }

    if (getBodySize(req.body.metadata || {}) > MAX_ANALYTICS_METADATA_LENGTH) {
      rejectBadRequest('metadata ist zu gross.');
    }

    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  validateAnalyticsPayload,
  validateBasketQuery,
  validateCategoryFilterQuery,
  validateFeedbackPayload,
  validatePublicPayloadSize,
  validateRankingQuery,
  validateShareId,
  validateSharePayload,
};
