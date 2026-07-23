const Offer = require('../../models/Offer');
const {
  OFFER_RANKING_FIELDS,
  buildRankedOffer,
  filterFreshActiveOffers,
  normalizeRetailerKey,
} = require('./offerRankingService');
const { classifyOfferSourceQuality } = require('./sourceQuality');

const DEFAULT_TOP_DEALS_LIMIT = 20;
const MAX_TOP_DEALS_LIMIT = 20;
const TOP_DEALS_CANDIDATE_LIMIT = 2000;
const TOP_DEALS_CACHE_TTL_MS = 2 * 60 * 1000;
const ALLOWED_UNITS = new Set(['kg', 'l', 'Stk']);
const EXCLUDED_RETAILERS = new Set(['spar', 'eurospar', 'interspar', 'hofer', 'pagro']);
const ALLOWED_RETAILER_FILTERS = new Set(['billa', 'billa-plus', 'lidl', 'penny', 'dm', 'bipa', 'mueller']);
const ALLOWED_CATEGORY_FILTERS = new Set([
  'getraenke',
  'drogerie',
  'haushalt',
  'kaffee',
  'bier',
  'waschmittel',
  'zahnpasta',
  'sonnencreme',
  'toilettenpapier',
]);
let cachedTopDeals = null;

function finitePositive(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function normalizeLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TOP_DEALS_LIMIT;
  return Math.min(Math.trunc(parsed), MAX_TOP_DEALS_LIMIT);
}

function normalizeFilterText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeTopDealsFilters({ category = '', retailer = '' } = {}) {
  const requestedCategory = normalizeFilterText(category).replace(/\s+/g, '-');
  const requestedRetailer = normalizeRetailerKey(retailer);
  const categoryValid = !requestedCategory || ALLOWED_CATEGORY_FILTERS.has(requestedCategory);
  const retailerValid = !requestedRetailer || ALLOWED_RETAILER_FILTERS.has(requestedRetailer);

  return {
    category: categoryValid ? requestedCategory : '',
    retailer: retailerValid ? requestedRetailer : '',
    invalid: !categoryValid || !retailerValid,
  };
}

function matchesCategoryFilter(deal, category) {
  if (!category) return true;
  const primary = normalizeFilterText(deal?.categoryPrimary);
  const secondary = normalizeFilterText(deal?.categorySecondary || deal?.displayCategory);
  const title = normalizeFilterText([deal?.title, deal?.brand].filter(Boolean).join(' '));

  if (category === 'getraenke') return primary === 'getraenke';
  if (category === 'drogerie') return primary === 'drogerie hygiene';
  if (category === 'haushalt') return primary === 'haushalt';
  if (category === 'kaffee') return secondary === 'kaffee tee';
  if (category === 'bier') return secondary === 'bier';
  if (category === 'waschmittel') return /^waschmittel (?:reiniger|reinigung)$/.test(secondary);
  if (category === 'zahnpasta') return secondary === 'mund zahnpflege' && /\bzahnpasta\b/.test(title);
  if (category === 'sonnencreme') {
    return secondary === 'koerperpflege' && /\b(?:sonnencreme|sonnenmilch|sonnenschutz)\b/.test(title);
  }
  if (category === 'toilettenpapier') return secondary === 'haushaltspapier' && /\btoilettenpapier\b/.test(title);
  return false;
}

function matchesTopDealsFilters(deal, filters) {
  if (filters.invalid) return false;
  const retailerKey = normalizeRetailerKey(deal?.retailerKey || deal?.retailerName || '');
  return (!filters.retailer || retailerKey === filters.retailer)
    && matchesCategoryFilter(deal, filters.category);
}

function buildAvailableFilters(deals = []) {
  const categories = [];
  const retailers = [];

  for (const key of ALLOWED_CATEGORY_FILTERS) {
    const count = deals.filter((deal) => matchesCategoryFilter(deal, key)).length;
    if (count > 0) categories.push({ key, count });
  }

  for (const key of ALLOWED_RETAILER_FILTERS) {
    const count = deals.filter((deal) => (
      normalizeRetailerKey(deal?.retailerKey || deal?.retailerName || '') === key
    )).length;
    if (count > 0) retailers.push({ key, count });
  }

  return { categories, retailers };
}

function hasRiskyPublishState(offer) {
  return /retained|stale|failed|error|inactive/i.test(String(offer?.publishStatus || ''));
}

function hasUnclearQuantityRisk(offer) {
  const reasons = Array.isArray(offer?.reviewReasons) ? offer.reviewReasons.join(' ') : '';
  return /quantity|unit-(?:unclear|conflict)|package-size-unclear|fragment/i.test(reasons);
}

function hasClearPriceConditions(offer) {
  const conditionRelevant = Boolean(
    offer?.customerProgramRequired
    || offer?.isMultiBuy
    || Number(offer?.minimumPurchaseQty || offer?.minimumPurchaseQuantity || 1) > 1
    || offer?.hasConditions
  );

  return !conditionRelevant || Boolean(String(offer?.conditionsText || '').trim());
}

function hasKnownCategoryMismatch(offer) {
  const retailerKey = normalizeRetailerKey(offer?.retailerKey || offer?.retailerName || '');
  const sourceType = String(offer?.sourceType || '').toLowerCase();
  const title = String(offer?.title || '').toLowerCase();
  const displayCategory = String(offer?.displayCategory || '').toLowerCase();

  return ['billa', 'billa-plus'].includes(retailerKey)
    && sourceType === 'billa-official-algolia'
    && /\blindt\b.*\blindor\b.*\bkugeln\b/.test(title)
    && displayCategory === 'milchprodukte';
}

function buildCandidateDecision(rawOffer, now = new Date()) {
  const retailerKey = normalizeRetailerKey(rawOffer?.retailerKey || rawOffer?.retailerName || '');
  if (EXCLUDED_RETAILERS.has(retailerKey)) return { accepted: false, reason: 'excluded-retailer' };
  const validTo = rawOffer?.validTo ? new Date(rawOffer.validTo) : null;
  if (validTo && !Number.isNaN(validTo.getTime()) && validTo.getTime() < now.getTime()) {
    return { accepted: false, reason: 'expired' };
  }
  if (!filterFreshActiveOffers([rawOffer], now).length) return { accepted: false, reason: 'not-fresh-public' };
  if (String(rawOffer?.sourceRunStatus || '') !== 'success') return { accepted: false, reason: 'source-run-not-success' };
  if (hasRiskyPublishState(rawOffer)) return { accepted: false, reason: 'retained-or-stale' };

  const sourceQuality = classifyOfferSourceQuality(rawOffer, now);
  if (!sourceQuality.hasOfficialEvidence || sourceQuality.sourceTrustLevel !== 'high' || sourceQuality.isLowConfidenceAggregator) {
    return { accepted: false, reason: 'source-not-trusted' };
  }

  const offer = buildRankedOffer(rawOffer, null, null);
  const price = finitePositive(offer?.priceCurrent?.amount);
  const unitPrice = finitePositive(offer?.normalizedUnitPrice?.amount);
  const unit = String(offer?.normalizedUnitPrice?.unit || '');
  const totalComparableAmount = finitePositive(offer?.totalComparableAmount);

  if (!price) return { accepted: false, reason: 'price-missing' };
  if (!unitPrice || offer?.normalizedUnitPrice?.comparable !== true || !ALLOWED_UNITS.has(unit) || !totalComparableAmount) {
    return { accepted: false, reason: 'unit-price-unsafe' };
  }
  if (hasUnclearQuantityRisk(rawOffer)) return { accepted: false, reason: 'quantity-risk' };
  if (hasKnownCategoryMismatch(offer)) return { accepted: false, reason: 'category-implausible' };
  if (!offer?.displayCategory || /unkategorisiert/i.test(offer.displayCategory)) {
    return { accepted: false, reason: 'category-missing' };
  }
  if (!hasClearPriceConditions(offer)) return { accepted: false, reason: 'condition-missing' };

  const referencePrice = finitePositive(offer?.referencePrice?.amount);
  const referenceConfidence = Number(offer?.referencePrice?.confidence || 0);
  if (
    !referencePrice
    || referencePrice <= price
    || offer?.referencePrice?.type !== 'direct_source_reference_price'
    || offer?.referencePrice?.allowsSavings !== true
    || offer?.referencePrice?.isApproximate === true
    || referenceConfidence < 0.8
  ) {
    return { accepted: false, reason: 'reference-price-unsafe' };
  }

  const currentCurrency = String(offer?.priceCurrent?.currency || 'EUR');
  const referenceCurrency = String(rawOffer?.priceReference?.currency || currentCurrency);
  if (currentCurrency !== referenceCurrency) return { accepted: false, reason: 'reference-currency-mismatch' };

  const referenceUnitPriceAmount = unitPrice * (referencePrice / price);
  const discountPercent = ((referenceUnitPriceAmount - unitPrice) / referenceUnitPriceAmount) * 100;
  const savingsAmount = finitePositive(offer?.savingsAmount);

  if (
    !Number.isFinite(referenceUnitPriceAmount)
    || referenceUnitPriceAmount <= unitPrice
    || !Number.isFinite(discountPercent)
    || discountPercent <= 0
    || discountPercent >= 100
    || !savingsAmount
  ) {
    return { accepted: false, reason: 'savings-not-calculable' };
  }

  return {
    accepted: true,
    deal: {
      ...offer,
      topDeal: {
        reason: 'Starke Ersparnis nach Preis pro Einheit',
        discountPercent: round(discountPercent),
        savingsAmount: round(savingsAmount),
        unitPriceSavingsAmount: round(referenceUnitPriceAmount - unitPrice),
        currentUnitPrice: {
          amount: round(unitPrice),
          unit,
        },
        referenceUnitPrice: {
          amount: round(referenceUnitPriceAmount),
          unit,
        },
      },
    },
  };
}

function compareTopDeals(left, right) {
  const percentDifference = Number(right?.topDeal?.discountPercent || 0) - Number(left?.topDeal?.discountPercent || 0);
  if (percentDifference !== 0) return percentDifference;

  const unitSavingsDifference = Number(right?.topDeal?.unitPriceSavingsAmount || 0) - Number(left?.topDeal?.unitPriceSavingsAmount || 0);
  if (unitSavingsDifference !== 0) return unitSavingsDifference;

  const currentUnitPriceDifference = Number(left?.topDeal?.currentUnitPrice?.amount || 0) - Number(right?.topDeal?.currentUnitPrice?.amount || 0);
  if (currentUnitPriceDifference !== 0) return currentUnitPriceDifference;

  const savingsDifference = Number(right?.topDeal?.savingsAmount || 0) - Number(left?.topDeal?.savingsAmount || 0);
  if (savingsDifference !== 0) return savingsDifference;

  const imageDifference = Number(Boolean(right?.imageUrl)) - Number(Boolean(left?.imageUrl));
  if (imageDifference !== 0) return imageDifference;

  const sourceDifference = String(left?.sourceType || '').localeCompare(String(right?.sourceType || ''), 'de');
  if (sourceDifference !== 0) return sourceDifference;

  return `${left?.retailerName || ''}-${left?.title || ''}`.localeCompare(
    `${right?.retailerName || ''}-${right?.title || ''}`,
    'de'
  );
}

function getDealIdentity(deal) {
  const retailerKey = normalizeRetailerKey(deal?.retailerKey || deal?.retailerName || '');
  const retailerFamily = ['billa', 'billa-plus'].includes(retailerKey) ? 'billa-family' : retailerKey;
  const title = String(deal?.titleNormalized || deal?.title || '').toLocaleLowerCase('de-AT').replace(/[^a-z0-9äöüß]+/g, ' ').trim();
  return [
    retailerFamily,
    title,
    deal?.priceCurrent?.amount,
    deal?.topDeal?.currentUnitPrice?.amount,
    deal?.topDeal?.referenceUnitPrice?.amount,
    deal?.topDeal?.currentUnitPrice?.unit,
  ].join('|');
}

function buildTopDealsFromOffers(offers = [], {
  limit = DEFAULT_TOP_DEALS_LIMIT,
  now = new Date(),
  category = '',
  retailer = '',
} = {}) {
  const excludedReasons = {};
  const accepted = [];

  for (const offer of offers) {
    const decision = buildCandidateDecision(offer, now);
    if (decision.accepted) {
      accepted.push(decision.deal);
    } else {
      excludedReasons[decision.reason] = Number(excludedReasons[decision.reason] || 0) + 1;
    }
  }

  const uniqueGuardedDeals = [];
  const seen = new Set();
  for (const deal of accepted.sort(compareTopDeals)) {
    const identity = getDealIdentity(deal);
    if (seen.has(identity)) continue;
    seen.add(identity);
    uniqueGuardedDeals.push(deal);
  }

  const safeLimit = normalizeLimit(limit);
  const filters = normalizeTopDealsFilters({ category, retailer });
  const availableFilters = buildAvailableFilters(uniqueGuardedDeals);
  const uniqueDeals = uniqueGuardedDeals.filter((deal) => matchesTopDealsFilters(deal, filters));
  return {
    generatedAt: now.toISOString(),
    count: Math.min(uniqueDeals.length, safeLimit),
    candidateCount: uniqueDeals.length,
    totalGuardedCandidateCount: uniqueGuardedDeals.length,
    filteredOutCount: uniqueGuardedDeals.length - uniqueDeals.length,
    limit: safeLimit,
    filters: {
      category: filters.category,
      retailer: filters.retailer,
      invalid: filters.invalid,
    },
    availableFilters,
    deals: uniqueDeals.slice(0, safeLimit),
    excludedReasons,
    methodology: {
      primarySort: 'verified-unit-savings-percent',
      secondarySort: 'absolute-unit-price-savings',
      tertiarySort: 'lower-current-unit-price',
      referencePrice: 'direct-source-reference-only',
      fewerThanLimitAllowed: true,
    },
  };
}

async function buildTopDeals({
  limit = DEFAULT_TOP_DEALS_LIMIT,
  now = new Date(),
  category = '',
  retailer = '',
} = {}) {
  const safeLimit = normalizeLimit(limit);
  const filters = normalizeTopDealsFilters({ category, retailer });
  const cacheKey = [safeLimit, filters.category, filters.retailer, filters.invalid].join('|');
  const nowMs = now.getTime();
  if (cachedTopDeals && cachedTopDeals.expiresAt > nowMs && cachedTopDeals.cacheKey === cacheKey) {
    return cachedTopDeals.response;
  }

  const offers = await Offer.find({
    status: 'active',
    isActiveNow: true,
    'priceCurrent.amount': { $gt: 0 },
    'priceReference.amount': { $gt: 0 },
    'normalizedUnitPrice.amount': { $gt: 0 },
    'normalizedUnitPrice.comparable': true,
  })
    .select(OFFER_RANKING_FIELDS)
    .limit(TOP_DEALS_CANDIDATE_LIMIT)
    .maxTimeMS(2500)
    .lean();

  const response = buildTopDealsFromOffers(offers, {
    limit: safeLimit,
    now,
    category,
    retailer,
  });
  cachedTopDeals = {
    expiresAt: nowMs + TOP_DEALS_CACHE_TTL_MS,
    cacheKey,
    response,
  };
  return response;
}

function clearTopDealsCache() {
  cachedTopDeals = null;
}

module.exports = {
  buildAvailableFilters,
  buildCandidateDecision,
  buildTopDeals,
  buildTopDealsFromOffers,
  clearTopDealsCache,
  compareTopDeals,
  matchesTopDealsFilters,
  normalizeLimit,
  normalizeTopDealsFilters,
};
