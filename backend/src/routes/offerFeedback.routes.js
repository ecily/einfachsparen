const express = require('express');
const OfferFeedback = require('../models/OfferFeedback');
const { offerFeedbackRateLimit } = require('../middleware/rateLimits');

const REASON_VALUES = new Set([
  'price_wrong',
  'condition_wrong',
  'image_wrong',
  'category_wrong',
  'duplicate',
  'expired_or_not_found',
  'offer_nonsense',
  'search_result_wrong',
  'other',
]);

const CONDITION_ISSUE_TYPES = new Set([
  'missing_condition',
  'wrong_condition',
  'duplicate_or_conflicting',
  'customer_program_missing',
  'unclear',
  'other',
]);

const IMAGE_ISSUE_TYPES = new Set([
  'missing_image',
  'wrong_product_image',
  'broken_image',
  'unclear',
  'other',
]);

const EXPIRED_ISSUE_TYPES = new Set([
  'not_found_in_store',
  'expired',
  'not_found_online',
  'unclear',
  'other',
]);

const SEARCH_RESULT_ISSUE_TYPES = new Set([
  'irrelevant_for_query',
  'substring_false_positive',
  'brand_name_false_positive',
  'wrong_intent',
  'unclear',
  'other',
]);

const OFFER_NONSENSE_ISSUE_TYPES = new Set([
  'broken_title',
  'incomplete_product_text',
  'nonsensical_product',
  'broken_price_or_quantity',
  'wrong_source_merge',
  'unclear',
  'other',
]);

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function rejectBadRequest(message) {
  throw createHttpError(400, message);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function trimString(value, { field, maxLength, required = false, nullable = true } = {}) {
  if (value === undefined || value === null) {
    if (required) {
      rejectBadRequest(`${field} ist erforderlich.`);
    }

    return nullable ? null : '';
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

  if (!trimmed && nullable) {
    return null;
  }

  return trimmed;
}

function optionalBoolean(value, field) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'boolean') {
    rejectBadRequest(`${field} muss wahr oder falsch sein.`);
  }

  return value;
}

function optionalNumber(value, field) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    rejectBadRequest(`${field} muss eine Zahl sein.`);
  }

  return value;
}

function optionalInteger(value, field) {
  const number = optionalNumber(value, field);

  if (number === null) {
    return null;
  }

  if (!Number.isInteger(number)) {
    rejectBadRequest(`${field} muss eine ganze Zahl sein.`);
  }

  return number;
}

function optionalDate(value, field) {
  const text = trimString(value, { field, maxLength: 80 });

  if (!text) {
    return null;
  }

  const date = new Date(text);

  if (Number.isNaN(date.getTime())) {
    rejectBadRequest(`${field} ist kein gueltiges Datum.`);
  }

  return date;
}

function normalizeStringArray(value, { field, maxItems = 20, maxLength = 120 } = {}) {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    rejectBadRequest(`${field} muss eine Liste sein.`);
  }

  if (value.length > maxItems) {
    rejectBadRequest(`${field} enthaelt zu viele Werte.`);
  }

  return value
    .map((item) => trimString(item, { field, maxLength }))
    .filter(Boolean);
}

function normalizeEnumArray(value, { field, allowedValues, maxItems = 20 } = {}) {
  const items = normalizeStringArray(value, { field, maxItems, maxLength: 80 });
  const uniqueItems = [];

  for (const item of items) {
    if (!allowedValues.has(item)) {
      rejectBadRequest(`${field} enthaelt einen ungueltigen Wert.`);
    }

    if (!uniqueItems.includes(item)) {
      uniqueItems.push(item);
    }
  }

  return uniqueItems;
}

function assignIfPresent(target, key, value) {
  if (value !== null && value !== undefined) {
    target[key] = value;
  }
}

function normalizeSmallObject(value, { field, maxKeys = 30, maxStringLength = 200 } = {}) {
  if (value === undefined || value === null) {
    return {};
  }

  if (!isPlainObject(value)) {
    rejectBadRequest(`${field} ist ungueltig.`);
  }

  const entries = Object.entries(value).slice(0, maxKeys);
  const normalized = {};

  for (const [key, rawValue] of entries) {
    const normalizedKey = String(key || '').trim();

    if (!normalizedKey || normalizedKey.length > 80) {
      continue;
    }

    if (typeof rawValue === 'string') {
      normalized[normalizedKey] = rawValue.trim().slice(0, maxStringLength);
    } else if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      normalized[normalizedKey] = rawValue;
    } else if (typeof rawValue === 'boolean') {
      normalized[normalizedKey] = rawValue;
    } else if (Array.isArray(rawValue)) {
      normalized[normalizedKey] = rawValue
        .slice(0, 20)
        .map((item) => String(item || '').trim().slice(0, maxStringLength))
        .filter(Boolean);
    }
  }

  return normalized;
}

function normalizeReasons(rawReasons) {
  if (!Array.isArray(rawReasons)) {
    rejectBadRequest('Mindestens ein Feedback-Grund ist erforderlich.');
  }

  if (rawReasons.length < 1) {
    rejectBadRequest('Mindestens ein Feedback-Grund ist erforderlich.');
  }

  if (rawReasons.length > REASON_VALUES.size) {
    rejectBadRequest('Zu viele Feedback-Gruende.');
  }

  const reasons = [];

  for (const rawReason of rawReasons) {
    const reason = trimString(rawReason, { field: 'reasons', maxLength: 80, required: true });

    if (!REASON_VALUES.has(reason)) {
      rejectBadRequest('Feedback-Grund ist ungueltig.');
    }

    if (!reasons.includes(reason)) {
      reasons.push(reason);
    }
  }

  if (reasons.length < 1) {
    rejectBadRequest('Mindestens ein Feedback-Grund ist erforderlich.');
  }

  return reasons;
}

function normalizePriceSnapshot(value, field) {
  const raw = isPlainObject(value) ? value : {};

  return {
    amount: optionalNumber(raw.amount, `${field}.amount`),
    currency: trimString(raw.currency || 'EUR', { field: `${field}.currency`, maxLength: 8, nullable: false }) || 'EUR',
  };
}

function normalizeOfferSnapshot(value) {
  const raw = isPlainObject(value) ? value : {};

  return {
    title: trimString(raw.title, { field: 'offerSnapshot.title', maxLength: 300, nullable: false }),
    brand: trimString(raw.brand, { field: 'offerSnapshot.brand', maxLength: 160 }),
    rawTitle: trimString(raw.rawTitle, { field: 'offerSnapshot.rawTitle', maxLength: 500 }),
    displayTitle: trimString(raw.displayTitle, { field: 'offerSnapshot.displayTitle', maxLength: 300 }),
    retailerKey: trimString(raw.retailerKey, { field: 'offerSnapshot.retailerKey', maxLength: 80, nullable: false }),
    retailerLabel: trimString(raw.retailerLabel, { field: 'offerSnapshot.retailerLabel', maxLength: 120, nullable: false }),
    retailerStoreType: trimString(raw.retailerStoreType, { field: 'offerSnapshot.retailerStoreType', maxLength: 80 }),
    priceCurrent: normalizePriceSnapshot(raw.priceCurrent, 'offerSnapshot.priceCurrent'),
    priceOriginal: normalizePriceSnapshot(raw.priceOriginal, 'offerSnapshot.priceOriginal'),
    savingsPercent: optionalNumber(raw.savingsPercent, 'offerSnapshot.savingsPercent'),
    savingsAmount: optionalNumber(raw.savingsAmount, 'offerSnapshot.savingsAmount'),
    quantity: trimString(raw.quantity, { field: 'offerSnapshot.quantity', maxLength: 120 }),
    normalizedUnitPrice: {
      amount: optionalNumber(raw.normalizedUnitPrice?.amount, 'offerSnapshot.normalizedUnitPrice.amount'),
      unit: trimString(raw.normalizedUnitPrice?.unit, {
        field: 'offerSnapshot.normalizedUnitPrice.unit',
        maxLength: 40,
      }),
      comparable: optionalBoolean(raw.normalizedUnitPrice?.comparable, 'offerSnapshot.normalizedUnitPrice.comparable'),
    },
    categoryPrimary: trimString(raw.categoryPrimary, { field: 'offerSnapshot.categoryPrimary', maxLength: 120 }),
    categorySecondary: trimString(raw.categorySecondary, { field: 'offerSnapshot.categorySecondary', maxLength: 120 }),
    conditionsText: trimString(raw.conditionsText, { field: 'offerSnapshot.conditionsText', maxLength: 1000 }),
    conditionBadges: normalizeStringArray(raw.conditionBadges, {
      field: 'offerSnapshot.conditionBadges',
      maxItems: 20,
      maxLength: 160,
    }),
    visibleBadges: normalizeStringArray(raw.visibleBadges, {
      field: 'offerSnapshot.visibleBadges',
      maxItems: 30,
      maxLength: 160,
    }),
    customerProgramRequired: optionalBoolean(raw.customerProgramRequired, 'offerSnapshot.customerProgramRequired'),
    validityText: trimString(raw.validityText, { field: 'offerSnapshot.validityText', maxLength: 300 }),
    validFrom: optionalDate(raw.validFrom, 'offerSnapshot.validFrom'),
    validTo: optionalDate(raw.validTo, 'offerSnapshot.validTo'),
    imagePresent: optionalBoolean(raw.imagePresent, 'offerSnapshot.imagePresent'),
    imageUrlPresent: optionalBoolean(raw.imageUrlPresent, 'offerSnapshot.imageUrlPresent'),
    sourceName: trimString(raw.sourceName, { field: 'offerSnapshot.sourceName', maxLength: 160 }),
    sourceUrl: trimString(raw.sourceUrl, { field: 'offerSnapshot.sourceUrl', maxLength: 1000 }),
    sourceType: trimString(raw.sourceType, { field: 'offerSnapshot.sourceType', maxLength: 80 }),
    sourceTypes: normalizeStringArray(raw.sourceTypes, {
      field: 'offerSnapshot.sourceTypes',
      maxItems: 20,
      maxLength: 80,
    }),
  };
}

function normalizeOfferRef(value) {
  const raw = isPlainObject(value) ? value : {};

  return {
    offerId: trimString(raw.offerId, { field: 'offerRef.offerId', maxLength: 120, nullable: false }),
    stableId: trimString(raw.stableId, { field: 'offerRef.stableId', maxLength: 160 }),
    sourceId: trimString(raw.sourceId, { field: 'offerRef.sourceId', maxLength: 120 }),
    dedupeKey: trimString(raw.dedupeKey, { field: 'offerRef.dedupeKey', maxLength: 240 }),
  };
}

function normalizePageContext(value) {
  const raw = isPlainObject(value) ? value : {};

  return {
    path: trimString(raw.path, { field: 'pageContext.path', maxLength: 500 }),
    routeName: trimString(raw.routeName, { field: 'pageContext.routeName', maxLength: 120 }),
    url: trimString(raw.url, { field: 'pageContext.url', maxLength: 1000 }),
    query: trimString(raw.query, { field: 'pageContext.query', maxLength: 500 }),
    sortMode: trimString(raw.sortMode, { field: 'pageContext.sortMode', maxLength: 80 }),
    activeRetailers: normalizeStringArray(raw.activeRetailers, {
      field: 'pageContext.activeRetailers',
      maxItems: 20,
      maxLength: 80,
    }),
    activeCategories: normalizeStringArray(raw.activeCategories, {
      field: 'pageContext.activeCategories',
      maxItems: 20,
      maxLength: 120,
    }),
    programRetailers: normalizeStringArray(raw.programRetailers, {
      field: 'pageContext.programRetailers',
      maxItems: 20,
      maxLength: 80,
    }),
    onlyWithoutProgram: optionalBoolean(raw.onlyWithoutProgram, 'pageContext.onlyWithoutProgram'),
    activeFilters: normalizeSmallObject(raw.activeFilters, { field: 'pageContext.activeFilters' }),
    resultPosition: optionalInteger(raw.resultPosition, 'pageContext.resultPosition'),
    viewport: trimString(raw.viewport, { field: 'pageContext.viewport', maxLength: 40 }),
  };
}

function normalizeClientContext(value, req) {
  const raw = isPlainObject(value) ? value : {};
  const headerUserAgent = trimString(req.get?.('user-agent'), {
    field: 'clientContext.userAgent',
    maxLength: 500,
  });

  return {
    userAgent: trimString(raw.userAgent, { field: 'clientContext.userAgent', maxLength: 500 }) || headerUserAgent,
    sessionIdHash: trimString(raw.sessionIdHash, { field: 'clientContext.sessionIdHash', maxLength: 128 }),
    feedbackSource: trimString(raw.feedbackSource || 'public-offer-card', {
      field: 'clientContext.feedbackSource',
      maxLength: 80,
      nullable: false,
    }) || 'public-offer-card',
    uiComponent: trimString(raw.uiComponent, { field: 'clientContext.uiComponent', maxLength: 120 }),
    schemaVersion: trimString(raw.schemaVersion, { field: 'clientContext.schemaVersion', maxLength: 80 }),
    appVersion: trimString(raw.appVersion, { field: 'clientContext.appVersion', maxLength: 80 }),
    submittedAtClient: optionalDate(raw.submittedAtClient, 'clientContext.submittedAtClient'),
  };
}

function normalizeModeration(value) {
  const raw = isPlainObject(value) ? value : {};

  return {
    containsPersonalDataLikely: raw.containsPersonalDataLikely === true,
    spamScore: optionalNumber(raw.spamScore, 'moderation.spamScore') || 0,
  };
}

function normalizeCategoryWrongDetails(raw) {
  const details = {};
  assignIfPresent(details, 'currentCategoryPrimary', trimString(raw.currentCategoryPrimary, {
    field: 'structuredDetails.category_wrong.currentCategoryPrimary',
    maxLength: 120,
  }));
  assignIfPresent(details, 'currentCategorySecondary', trimString(raw.currentCategorySecondary, {
    field: 'structuredDetails.category_wrong.currentCategorySecondary',
    maxLength: 120,
  }));
  assignIfPresent(details, 'suggestedCategoryPrimary', trimString(raw.suggestedCategoryPrimary, {
    field: 'structuredDetails.category_wrong.suggestedCategoryPrimary',
    maxLength: 120,
  }));
  assignIfPresent(details, 'suggestedCategorySecondary', trimString(raw.suggestedCategorySecondary, {
    field: 'structuredDetails.category_wrong.suggestedCategorySecondary',
    maxLength: 120,
  }));
  assignIfPresent(details, 'suggestedCategoryUnknown', optionalBoolean(
    raw.suggestedCategoryUnknown,
    'structuredDetails.category_wrong.suggestedCategoryUnknown'
  ));
  assignIfPresent(details, 'userNote', trimString(raw.userNote, {
    field: 'structuredDetails.category_wrong.userNote',
    maxLength: 500,
  }));
  return details;
}

function normalizePriceWrongDetails(raw) {
  const details = {};
  assignIfPresent(details, 'visiblePrice', trimString(raw.visiblePrice, {
    field: 'structuredDetails.price_wrong.visiblePrice',
    maxLength: 120,
  }));
  assignIfPresent(details, 'seenPrice', optionalNumber(raw.seenPrice, 'structuredDetails.price_wrong.seenPrice'));
  assignIfPresent(details, 'seenPriceText', trimString(raw.seenPriceText, {
    field: 'structuredDetails.price_wrong.seenPriceText',
    maxLength: 120,
  }));
  assignIfPresent(details, 'seenAt', optionalDate(raw.seenAt, 'structuredDetails.price_wrong.seenAt'));
  assignIfPresent(details, 'userNote', trimString(raw.userNote, {
    field: 'structuredDetails.price_wrong.userNote',
    maxLength: 500,
  }));
  return details;
}

function normalizeConditionWrongDetails(raw) {
  const details = {};
  assignIfPresent(details, 'visibleConditions', normalizeStringArray(raw.visibleConditions, {
    field: 'structuredDetails.condition_wrong.visibleConditions',
    maxItems: 20,
    maxLength: 160,
  }));
  assignIfPresent(details, 'issueTypes', normalizeEnumArray(raw.issueTypes, {
    field: 'structuredDetails.condition_wrong.issueTypes',
    allowedValues: CONDITION_ISSUE_TYPES,
    maxItems: 6,
  }));
  assignIfPresent(details, 'userExpectedConditionText', trimString(raw.userExpectedConditionText, {
    field: 'structuredDetails.condition_wrong.userExpectedConditionText',
    maxLength: 500,
  }));
  assignIfPresent(details, 'userSawDifferentCondition', trimString(raw.userSawDifferentCondition, {
    field: 'structuredDetails.condition_wrong.userSawDifferentCondition',
    maxLength: 500,
  }));
  assignIfPresent(details, 'userNote', trimString(raw.userNote, {
    field: 'structuredDetails.condition_wrong.userNote',
    maxLength: 500,
  }));
  return details;
}

function normalizeImageWrongDetails(raw) {
  const details = {};
  assignIfPresent(details, 'issueTypes', normalizeEnumArray(raw.issueTypes, {
    field: 'structuredDetails.image_wrong.issueTypes',
    allowedValues: IMAGE_ISSUE_TYPES,
    maxItems: 5,
  }));
  assignIfPresent(details, 'userNote', trimString(raw.userNote, {
    field: 'structuredDetails.image_wrong.userNote',
    maxLength: 500,
  }));
  return details;
}

function normalizeExpiredDetails(raw) {
  const details = {};
  assignIfPresent(details, 'issueTypes', normalizeEnumArray(raw.issueTypes, {
    field: 'structuredDetails.expired_or_not_found.issueTypes',
    allowedValues: EXPIRED_ISSUE_TYPES,
    maxItems: 5,
  }));
  assignIfPresent(details, 'checkedWhere', trimString(raw.checkedWhere, {
    field: 'structuredDetails.expired_or_not_found.checkedWhere',
    maxLength: 240,
  }));
  assignIfPresent(details, 'userNote', trimString(raw.userNote, {
    field: 'structuredDetails.expired_or_not_found.userNote',
    maxLength: 500,
  }));
  return details;
}

function normalizeUserNoteOnlyDetails(raw, reason) {
  const details = {};
  assignIfPresent(details, 'userNote', trimString(raw.userNote, {
    field: `structuredDetails.${reason}.userNote`,
    maxLength: 500,
  }));
  return details;
}

function normalizeDuplicateDetails(raw) {
  const details = {};
  assignIfPresent(details, 'duplicateOfferId', trimString(raw.duplicateOfferId, {
    field: 'structuredDetails.duplicate.duplicateOfferId',
    maxLength: 120,
  }));
  assignIfPresent(details, 'duplicateVisibleTitle', trimString(raw.duplicateVisibleTitle, {
    field: 'structuredDetails.duplicate.duplicateVisibleTitle',
    maxLength: 300,
  }));
  assignIfPresent(details, 'duplicateReason', trimString(raw.duplicateReason, {
    field: 'structuredDetails.duplicate.duplicateReason',
    maxLength: 300,
  }));
  assignIfPresent(details, 'userNote', trimString(raw.userNote, {
    field: 'structuredDetails.duplicate.userNote',
    maxLength: 500,
  }));
  return details;
}

function normalizeOfferNonsenseDetails(raw) {
  const details = {};
  assignIfPresent(details, 'issueTypes', normalizeEnumArray(raw.issueTypes, {
    field: 'structuredDetails.offer_nonsense.issueTypes',
    allowedValues: OFFER_NONSENSE_ISSUE_TYPES,
    maxItems: 7,
  }));
  assignIfPresent(details, 'userNote', trimString(raw.userNote, {
    field: 'structuredDetails.offer_nonsense.userNote',
    maxLength: 500,
  }));
  return details;
}

function normalizeSearchResultWrongDetails(raw) {
  const details = {};
  assignIfPresent(details, 'query', trimString(raw.query, {
    field: 'structuredDetails.search_result_wrong.query',
    maxLength: 120,
  }));
  assignIfPresent(details, 'visibleTitle', trimString(raw.visibleTitle, {
    field: 'structuredDetails.search_result_wrong.visibleTitle',
    maxLength: 300,
  }));
  assignIfPresent(details, 'currentCategoryPrimary', trimString(raw.currentCategoryPrimary, {
    field: 'structuredDetails.search_result_wrong.currentCategoryPrimary',
    maxLength: 120,
  }));
  assignIfPresent(details, 'currentCategorySecondary', trimString(raw.currentCategorySecondary, {
    field: 'structuredDetails.search_result_wrong.currentCategorySecondary',
    maxLength: 120,
  }));
  assignIfPresent(details, 'expectedProductType', trimString(raw.expectedProductType, {
    field: 'structuredDetails.search_result_wrong.expectedProductType',
    maxLength: 160,
  }));
  assignIfPresent(details, 'expectedCategoryPrimary', trimString(raw.expectedCategoryPrimary, {
    field: 'structuredDetails.search_result_wrong.expectedCategoryPrimary',
    maxLength: 120,
  }));
  assignIfPresent(details, 'expectedCategorySecondary', trimString(raw.expectedCategorySecondary, {
    field: 'structuredDetails.search_result_wrong.expectedCategorySecondary',
    maxLength: 120,
  }));
  assignIfPresent(details, 'issueTypes', normalizeEnumArray(raw.issueTypes, {
    field: 'structuredDetails.search_result_wrong.issueTypes',
    allowedValues: SEARCH_RESULT_ISSUE_TYPES,
    maxItems: 6,
  }));
  assignIfPresent(details, 'userNote', trimString(raw.userNote, {
    field: 'structuredDetails.search_result_wrong.userNote',
    maxLength: 500,
  }));
  return details;
}

function normalizeStructuredDetails(value, reasons) {
  if (value === undefined || value === null) {
    return {};
  }

  if (!isPlainObject(value)) {
    rejectBadRequest('structuredDetails ist ungueltig.');
  }

  const normalized = {};
  const reasonSet = new Set(reasons);

  for (const reason of reasons) {
    const rawDetails = value[reason];

    if (rawDetails === undefined || rawDetails === null) {
      continue;
    }

    if (!isPlainObject(rawDetails)) {
      rejectBadRequest(`structuredDetails.${reason} ist ungueltig.`);
    }

    if (reason === 'category_wrong') {
      normalized.category_wrong = normalizeCategoryWrongDetails(rawDetails);
    } else if (reason === 'price_wrong') {
      normalized.price_wrong = normalizePriceWrongDetails(rawDetails);
    } else if (reason === 'condition_wrong') {
      normalized.condition_wrong = normalizeConditionWrongDetails(rawDetails);
    } else if (reason === 'image_wrong') {
      normalized.image_wrong = normalizeImageWrongDetails(rawDetails);
    } else if (reason === 'expired_or_not_found') {
      normalized.expired_or_not_found = normalizeExpiredDetails(rawDetails);
    } else if (reason === 'duplicate') {
      normalized.duplicate = normalizeDuplicateDetails(rawDetails);
    } else if (reason === 'offer_nonsense') {
      normalized.offer_nonsense = normalizeOfferNonsenseDetails(rawDetails);
    } else if (reason === 'search_result_wrong') {
      normalized.search_result_wrong = normalizeSearchResultWrongDetails(rawDetails);
    } else if (reasonSet.has(reason)) {
      normalized[reason] = normalizeUserNoteOnlyDetails(rawDetails, reason);
    }
  }

  return normalized;
}

function normalizeOfferFeedbackPayload(body, req = {}) {
  if (!isPlainObject(body)) {
    rejectBadRequest('Payload ist ungueltig.');
  }

  const reasons = normalizeReasons(body.reasons);
  const offerRef = normalizeOfferRef(body.offerRef);
  const offerSnapshot = normalizeOfferSnapshot(body.offerSnapshot);

  if (!offerRef.offerId && !offerSnapshot.title) {
    rejectBadRequest('Bitte Angebot oder Angebotstitel mitsenden.');
  }

  return {
    type: 'offer_feedback',
    status: 'new',
    priority: 'normal',
    reasons,
    offerRef,
    offerSnapshot,
    pageContext: normalizePageContext(body.pageContext),
    structuredDetails: normalizeStructuredDetails(body.structuredDetails, reasons),
    freeText: trimString(body.freeText, { field: 'freeText', maxLength: 800 }),
    clientContext: normalizeClientContext(body.clientContext, req),
    moderation: normalizeModeration(body.moderation),
  };
}

function createOfferFeedbackRouter({
  OfferFeedbackModel = OfferFeedback,
  rateLimitMiddleware = offerFeedbackRateLimit,
} = {}) {
  const router = express.Router();

  router.post('/', rateLimitMiddleware, async (req, res, next) => {
    try {
      const payload = normalizeOfferFeedbackPayload(req.body, req);
      const feedback = await OfferFeedbackModel.create(payload);

      res.status(201).json({
        ok: true,
        feedbackId: String(feedback._id),
        status: feedback.status || 'new',
      });
    } catch (error) {
      if (error.statusCode === 400) {
        return res.status(400).json({
          ok: false,
          message: error.message,
        });
      }

      return next(error);
    }
  });

  return router;
}

module.exports = createOfferFeedbackRouter();
module.exports.createOfferFeedbackRouter = createOfferFeedbackRouter;
module.exports.normalizeOfferFeedbackPayload = normalizeOfferFeedbackPayload;
module.exports.REASON_VALUES = REASON_VALUES;
