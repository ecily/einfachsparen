const Offer = require('../../models/Offer');
const {
  OFFER_RANKING_FIELDS,
  buildRankedOffer,
  filterFreshActiveOffers,
  normalizeRetailerKey,
} = require('./offerRankingService');
const { classifyOfferSourceQuality } = require('./sourceQuality');
const { isPublicValidityEligible } = require('./publicValidity');

const DEFAULT_TOP_DEALS_LIMIT = 20;
const MAX_TOP_DEALS_LIMIT = 20;
const TOP_DEALS_PER_RETAILER_CANDIDATE_LIMIT = 2500;
const TOP_DEALS_TOTAL_CANDIDATE_LIMIT = TOP_DEALS_PER_RETAILER_CANDIDATE_LIMIT * 8;
const TOP_DEALS_CACHE_TTL_MS = 2 * 60 * 1000;
const ALLOWED_UNITS = new Set(['kg', 'l', 'Stk']);
const EXCLUDED_RETAILERS = new Set(['spar', 'eurospar', 'interspar', 'hofer', 'pagro']);
const ALLOWED_RETAILER_FILTERS = new Set([
  'billa',
  'billa-plus',
  'lidl',
  'penny',
  'dm',
  'bipa',
  'mueller',
  'interspar',
]);
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
const cachedTopDeals = new Map();
const topDealsBuildPromises = new Map();
let topDealsCandidatePool = null;
let topDealsCandidatePoolPromise = null;
let topDealsCandidatePoolDateKey = '';
let topDealsCacheGeneration = 0;
let topDealsRankedMemoDateKey = '';
let topDealsRankedMemo = new WeakMap();

function timingNowMs() {
  return Number(process.hrtime.bigint()) / 1e6;
}

function addTiming(profile, key, startedAt) {
  if (profile) profile[key] = (profile[key] || 0) + (timingNowMs() - startedAt);
}

function getViennaDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Vienna',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date).reduce((result, part) => ({
    ...result,
    [part.type]: part.value,
  }), {});

  return parts.year && parts.month && parts.day ? `${parts.year}-${parts.month}-${parts.day}` : '';
}

function getTopDealsRankedMemo(now = new Date()) {
  const dateKey = getViennaDateKey(now);
  if (dateKey !== topDealsRankedMemoDateKey) {
    topDealsRankedMemoDateKey = dateKey;
    topDealsRankedMemo = new WeakMap();
  }
  return topDealsRankedMemo;
}

function buildTopDealsBaseQuery() {
  return {
    status: 'active',
    isActiveNow: true,
    'priceCurrent.amount': { $gt: 0 },
    $or: [
      { 'priceReference.amount': { $gt: 0 } },
      { discountPercent: { $gt: 0 } },
      { 'rawFacts.discountPercentage': { $gt: 0 } },
      { 'rawFacts.discountPercent': { $gt: 0 } },
    ],
  };
}

function getPublicValidityDeadlineMs(offer, now = new Date()) {
  const decision = isPublicValidityEligible(offer, now);
  if (!decision.eligible || !decision.publicUntil) return now.getTime();

  const publicUntil = new Date(decision.publicUntil);
  return Number.isNaN(publicUntil.getTime()) ? now.getTime() : publicUntil.getTime() + 1;
}

async function readTopDealsCandidatePool({ publish = true } = {}) {
  const generation = topDealsCacheGeneration;
  const dateKey = getViennaDateKey(new Date());
  const offers = await Offer.find({
    ...buildTopDealsBaseQuery(),
    retailerKey: { $in: [...ALLOWED_RETAILER_FILTERS] },
  })
    .select(`${OFFER_RANKING_FIELDS} needsReview`)
    .limit(TOP_DEALS_TOTAL_CANDIDATE_LIMIT)
    .maxTimeMS(2500)
    .lean();

  if (publish && generation === topDealsCacheGeneration) {
    topDealsCandidatePool = offers;
    topDealsCandidatePoolDateKey = dateKey;
  }
  return offers;
}

async function getTopDealsCandidatePool() {
  const currentDateKey = getViennaDateKey(new Date());
  if (topDealsCandidatePool && topDealsCandidatePoolDateKey === currentDateKey) {
    return topDealsCandidatePool;
  }
  if (topDealsCandidatePoolDateKey !== currentDateKey) {
    topDealsCandidatePool = null;
  }
  if (topDealsCandidatePoolPromise) return topDealsCandidatePoolPromise;

  const promise = readTopDealsCandidatePool();
  topDealsCandidatePoolPromise = promise;
  try {
    return await promise;
  } finally {
    if (topDealsCandidatePoolPromise === promise) {
      topDealsCandidatePoolPromise = null;
    }
  }
}

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

function buildAvailableFilters(strictDeals = [], fallbackDeals = []) {
  const categories = [];
  const retailers = [];

  for (const key of ALLOWED_CATEGORY_FILTERS) {
    const count = strictDeals.filter((deal) => matchesCategoryFilter(deal, key)).length;
    if (count > 0) categories.push({ key, count });
  }

  for (const key of ALLOWED_RETAILER_FILTERS) {
    const strictCount = strictDeals.filter((deal) => (
      normalizeRetailerKey(deal?.retailerKey || deal?.retailerName || '') === key
    )).length;
    const safeFallbackCount = fallbackDeals.filter((deal) => (
      normalizeRetailerKey(deal?.retailerKey || deal?.retailerName || '') === key
    )).length;
    const fallbackCount = strictCount > 0 ? 0 : safeFallbackCount;
    const totalShownCount = strictCount > 0 ? strictCount : fallbackCount;
    if (totalShownCount > 0) {
      retailers.push({
        key,
        count: totalShownCount,
        strictCount,
        fallbackCount,
        totalShownCount,
        mode: strictCount > 0 ? 'strict' : 'retailer_discount_fallback',
      });
    }
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

function hasFallbackFragmentRisk(rawOffer, offer) {
  const title = String(offer?.title || '').trim();
  const reviewText = Array.isArray(rawOffer?.reviewReasons) ? rawOffer.reviewReasons.join(' ') : '';
  return title.length < 3
    || /fragment|product-unclear|title-missing|nonsense/i.test(reviewText)
    || /^(?:gratis|aktion|angebot|-?\s*\d+\s*%)$/i.test(title);
}

function getFallbackSavingsEvidence(rawOffer, offer) {
  const price = finitePositive(offer?.priceCurrent?.amount);
  if (!price) return null;

  const referencePrice = finitePositive(offer?.referencePrice?.amount);
  const referenceConfidence = Number(offer?.referencePrice?.confidence || 0);
  const currentCurrency = String(offer?.priceCurrent?.currency || 'EUR');
  const referenceCurrency = String(rawOffer?.priceReference?.currency || currentCurrency);
  if (
    referencePrice
    && referencePrice > price
    && offer?.referencePrice?.type === 'direct_source_reference_price'
    && offer?.referencePrice?.allowsSavings === true
    && offer?.referencePrice?.isApproximate !== true
    && referenceConfidence >= 0.8
    && currentCurrency === referenceCurrency
  ) {
    const discountPercent = ((referencePrice - price) / referencePrice) * 100;
    if (discountPercent > 0 && discountPercent < 100) {
      return {
        discountPercent: round(discountPercent),
        savingsAmount: round(referencePrice - price),
        evidence: 'direct_source_reference_price',
      };
    }
  }

  const explicitDiscountPercent = finitePositive(
    rawOffer?.discountPercent
    ?? rawOffer?.rawFacts?.discountPercentage
    ?? rawOffer?.rawFacts?.discountPercent
  );
  const savingsConfidence = Number(rawOffer?.savingsConfidence || 0);
  if (
    explicitDiscountPercent
    && explicitDiscountPercent < 100
    && savingsConfidence >= 0.8
    && !finitePositive(rawOffer?.discountUpToPercent)
    && rawOffer?.rawFacts?.discountAppliesToProduct !== false
    && !/category|campaign/i.test(String(rawOffer?.rawFacts?.discountLevel || ''))
  ) {
    return {
      discountPercent: round(explicitDiscountPercent),
      savingsAmount: null,
      evidence: 'explicit_official_discount_percent',
    };
  }

  return null;
}

function buildRetailerFallbackDecision(rawOffer, now = new Date(), profile = null, memo = null) {
  const retailerKey = normalizeRetailerKey(rawOffer?.retailerKey || rawOffer?.retailerName || '');
  if (!ALLOWED_RETAILER_FILTERS.has(retailerKey)) {
    return { accepted: false, reason: 'fallback-retailer-not-allowed' };
  }
  const validTo = rawOffer?.validTo ? new Date(rawOffer.validTo) : null;
  if (validTo && !Number.isNaN(validTo.getTime()) && validTo.getTime() < now.getTime()) {
    return { accepted: false, reason: 'fallback-expired' };
  }
  const freshnessStartedAt = profile ? timingNowMs() : 0;
  const isFreshPublic = memo?.freshness?.has(rawOffer)
    ? memo.freshness.get(rawOffer)
    : filterFreshActiveOffers([rawOffer], now).length > 0;
  if (memo?.freshness && !memo.freshness.has(rawOffer)) memo.freshness.set(rawOffer, isFreshPublic);
  if (!isFreshPublic) {
    addTiming(profile, 'publicValidityMs', freshnessStartedAt);
    return { accepted: false, reason: 'fallback-not-fresh-public' };
  }
  addTiming(profile, 'publicValidityMs', freshnessStartedAt);
  if (String(rawOffer?.sourceRunStatus || '') !== 'success') {
    return { accepted: false, reason: 'fallback-source-run-not-success' };
  }
  if (hasRiskyPublishState(rawOffer)) {
    return { accepted: false, reason: 'fallback-retained-or-stale' };
  }

  const sourceStartedAt = profile ? timingNowMs() : 0;
  const sourceQuality = memo?.sourceQuality?.has(rawOffer)
    ? memo.sourceQuality.get(rawOffer)
    : classifyOfferSourceQuality(rawOffer, now);
  if (memo?.sourceQuality && !memo.sourceQuality.has(rawOffer)) memo.sourceQuality.set(rawOffer, sourceQuality);
  addTiming(profile, 'sourceQualityMs', sourceStartedAt);
  if (!sourceQuality.hasOfficialEvidence || sourceQuality.sourceTrustLevel !== 'high' || sourceQuality.isLowConfidenceAggregator) {
    return { accepted: false, reason: 'fallback-source-not-trusted' };
  }

  const normalizationStartedAt = profile ? timingNowMs() : 0;
  const offer = memo?.ranked?.has(rawOffer)
    ? memo.ranked.get(rawOffer)
    : buildRankedOffer(rawOffer, null, null, { now });
  if (memo?.ranked && !memo.ranked.has(rawOffer)) memo.ranked.set(rawOffer, offer);
  addTiming(profile, 'candidateNormalizationMs', normalizationStartedAt);
  if (String(offer?.offerType || '') !== 'product') {
    return { accepted: false, reason: 'fallback-not-product' };
  }
  if (!finitePositive(offer?.priceCurrent?.amount)) {
    return { accepted: false, reason: 'fallback-price-missing' };
  }
  if (hasFallbackFragmentRisk(rawOffer, offer)) {
    return { accepted: false, reason: 'fallback-fragment-risk' };
  }
  if (hasKnownCategoryMismatch(offer)) {
    return { accepted: false, reason: 'fallback-category-implausible' };
  }
  if (!offer?.displayCategory || /unkategorisiert/i.test(offer.displayCategory)) {
    return { accepted: false, reason: 'fallback-category-missing' };
  }
  if (!hasClearPriceConditions(offer)) {
    return { accepted: false, reason: 'fallback-condition-missing' };
  }

  const savingsEvidence = getFallbackSavingsEvidence(rawOffer, offer);
  if (!savingsEvidence) {
    return { accepted: false, reason: 'fallback-savings-unsafe' };
  }

  const topDeal = {
    mode: 'retailer_discount_fallback',
    reason: 'Top Deals nach Markt: höchste verifizierte Ersparnisse dieses Marktes',
    discountPercent: savingsEvidence.discountPercent,
    savingsAmount: savingsEvidence.savingsAmount,
    evidence: savingsEvidence.evidence,
  };
  const unitPrice = finitePositive(offer?.normalizedUnitPrice?.amount);
  const unit = String(offer?.normalizedUnitPrice?.unit || '');
  const totalComparableAmount = finitePositive(offer?.totalComparableAmount);
  if (
    unitPrice
    && offer?.normalizedUnitPrice?.comparable === true
    && ALLOWED_UNITS.has(unit)
    && totalComparableAmount
    && !hasUnclearQuantityRisk(rawOffer)
  ) {
    topDeal.currentUnitPrice = { amount: round(unitPrice), unit };
    if (savingsEvidence.evidence === 'direct_source_reference_price') {
      const price = finitePositive(offer?.priceCurrent?.amount);
      const referencePrice = finitePositive(offer?.referencePrice?.amount);
      topDeal.referenceUnitPrice = {
        amount: round(unitPrice * (referencePrice / price)),
        unit,
      };
    }
  }

  return {
    accepted: true,
    deal: {
      ...offer,
      topDeal,
    },
  };
}

function buildCandidateDecision(rawOffer, now = new Date(), profile = null, memo = null) {
  const retailerKey = normalizeRetailerKey(rawOffer?.retailerKey || rawOffer?.retailerName || '');
  if (EXCLUDED_RETAILERS.has(retailerKey)) return { accepted: false, reason: 'excluded-retailer' };
  const validTo = rawOffer?.validTo ? new Date(rawOffer.validTo) : null;
  if (validTo && !Number.isNaN(validTo.getTime()) && validTo.getTime() < now.getTime()) {
    return { accepted: false, reason: 'expired' };
  }
  const freshnessStartedAt = profile ? timingNowMs() : 0;
  const isFreshPublic = memo?.freshness?.has(rawOffer)
    ? memo.freshness.get(rawOffer)
    : filterFreshActiveOffers([rawOffer], now).length > 0;
  if (memo?.freshness && !memo.freshness.has(rawOffer)) memo.freshness.set(rawOffer, isFreshPublic);
  if (!isFreshPublic) {
    addTiming(profile, 'publicValidityMs', freshnessStartedAt);
    return { accepted: false, reason: 'not-fresh-public' };
  }
  addTiming(profile, 'publicValidityMs', freshnessStartedAt);
  if (String(rawOffer?.sourceRunStatus || '') !== 'success') return { accepted: false, reason: 'source-run-not-success' };
  if (hasRiskyPublishState(rawOffer)) return { accepted: false, reason: 'retained-or-stale' };

  const sourceStartedAt = profile ? timingNowMs() : 0;
  const sourceQuality = memo?.sourceQuality?.has(rawOffer)
    ? memo.sourceQuality.get(rawOffer)
    : classifyOfferSourceQuality(rawOffer, now);
  if (memo?.sourceQuality && !memo.sourceQuality.has(rawOffer)) memo.sourceQuality.set(rawOffer, sourceQuality);
  addTiming(profile, 'sourceQualityMs', sourceStartedAt);
  if (!sourceQuality.hasOfficialEvidence || sourceQuality.sourceTrustLevel !== 'high' || sourceQuality.isLowConfidenceAggregator) {
    return { accepted: false, reason: 'source-not-trusted' };
  }

  const normalizationStartedAt = profile ? timingNowMs() : 0;
  const offer = memo?.ranked?.has(rawOffer)
    ? memo.ranked.get(rawOffer)
    : buildRankedOffer(rawOffer, null, null, { now });
  if (memo?.ranked && !memo.ranked.has(rawOffer)) memo.ranked.set(rawOffer, offer);
  addTiming(profile, 'candidateNormalizationMs', normalizationStartedAt);
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

function compareRetailerFallbackDeals(left, right) {
  const percentDifference = Number(right?.topDeal?.discountPercent || 0) - Number(left?.topDeal?.discountPercent || 0);
  if (percentDifference !== 0) return percentDifference;

  const savingsDifference = Number(right?.topDeal?.savingsAmount || 0) - Number(left?.topDeal?.savingsAmount || 0);
  if (savingsDifference !== 0) return savingsDifference;

  const imageDifference = Number(Boolean(right?.imageUrl)) - Number(Boolean(left?.imageUrl));
  if (imageDifference !== 0) return imageDifference;

  const priceDifference = Number(left?.priceCurrent?.amount || 0) - Number(right?.priceCurrent?.amount || 0);
  if (priceDifference !== 0) return priceDifference;

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
  debugTiming = false,
  rankedMemo = null,
} = {}) {
  const profile = debugTiming ? { candidateCount: offers.length, startedAt: timingNowMs() } : null;
  const excludedReasons = {};
  const fallbackExcludedReasons = {};
  const accepted = [];
  let cacheValidUntilMs = now.getTime() + TOP_DEALS_CACHE_TTL_MS;
  const memo = {
    freshness: new WeakMap(),
    sourceQuality: new WeakMap(),
    ranked: rankedMemo || new WeakMap(),
  };

  for (const offer of offers) {
    const decisionStartedAt = profile ? timingNowMs() : 0;
    const decision = buildCandidateDecision(offer, now, profile, memo);
    addTiming(profile, 'strictDecisionMs', decisionStartedAt);
    if (decision.accepted) {
      accepted.push(decision.deal);
      cacheValidUntilMs = Math.min(cacheValidUntilMs, getPublicValidityDeadlineMs(offer, now));
    } else {
      excludedReasons[decision.reason] = Number(excludedReasons[decision.reason] || 0) + 1;
    }
  }

  const uniqueGuardedDeals = [];
  const seen = new Set();
  const strictSortStartedAt = profile ? timingNowMs() : 0;
  for (const deal of accepted.sort(compareTopDeals)) {
    const identity = getDealIdentity(deal);
    if (seen.has(identity)) continue;
    seen.add(identity);
    uniqueGuardedDeals.push(deal);
  }
  addTiming(profile, 'strictSortDedupeMs', strictSortStartedAt);

  const strictRetailerKeys = new Set(uniqueGuardedDeals.map((deal) => (
    normalizeRetailerKey(deal?.retailerKey || deal?.retailerName || '')
  )));
  const fallbackAccepted = [];
  for (const offer of offers) {
    const retailerKey = normalizeRetailerKey(offer?.retailerKey || offer?.retailerName || '');
    if (strictRetailerKeys.has(retailerKey)) continue;

    const decisionStartedAt = profile ? timingNowMs() : 0;
    const fallbackDecision = buildRetailerFallbackDecision(offer, now, profile, memo);
    addTiming(profile, 'fallbackDecisionMs', decisionStartedAt);
    if (fallbackDecision.accepted) {
      fallbackAccepted.push(fallbackDecision.deal);
      cacheValidUntilMs = Math.min(cacheValidUntilMs, getPublicValidityDeadlineMs(offer, now));
    } else {
      fallbackExcludedReasons[fallbackDecision.reason] = Number(
        fallbackExcludedReasons[fallbackDecision.reason] || 0
      ) + 1;
    }
  }

  const uniqueFallbackDeals = [];
  const fallbackSeen = new Set();
  const fallbackSortStartedAt = profile ? timingNowMs() : 0;
  for (const deal of fallbackAccepted.sort(compareRetailerFallbackDeals)) {
    const identity = getDealIdentity(deal);
    if (fallbackSeen.has(identity)) continue;
    fallbackSeen.add(identity);
    uniqueFallbackDeals.push(deal);
  }
  addTiming(profile, 'fallbackSortDedupeMs', fallbackSortStartedAt);

  const safeLimit = normalizeLimit(limit);
  const filters = normalizeTopDealsFilters({ category, retailer });
  const availableFilters = buildAvailableFilters(uniqueGuardedDeals, uniqueFallbackDeals);
  const strictDeals = uniqueGuardedDeals.filter((deal) => matchesTopDealsFilters(deal, filters));
  const retailerFallbackDeals = filters.retailer && !filters.category && strictDeals.length === 0
    ? uniqueFallbackDeals.filter((deal) => (
      normalizeRetailerKey(deal?.retailerKey || deal?.retailerName || '') === filters.retailer
    ))
    : [];
  const useRetailerFallback = !filters.invalid && retailerFallbackDeals.length > 0;
  const uniqueDeals = useRetailerFallback ? retailerFallbackDeals : strictDeals;
  const mode = useRetailerFallback ? 'retailer_discount_fallback' : 'strict';
  const selectedPoolCount = useRetailerFallback ? uniqueFallbackDeals.length : uniqueGuardedDeals.length;
  const responseStartedAt = profile ? timingNowMs() : 0;
  const response = {
    generatedAt: now.toISOString(),
    count: Math.min(uniqueDeals.length, safeLimit),
    candidateCount: uniqueDeals.length,
    totalGuardedCandidateCount: uniqueGuardedDeals.length,
    totalFallbackCandidateCount: uniqueFallbackDeals.length,
    filteredOutCount: Math.max(0, selectedPoolCount - uniqueDeals.length),
    limit: safeLimit,
    mode,
    reason: useRetailerFallback
      ? 'Top Deals nach Markt: höchste verifizierte Ersparnisse dieses Marktes'
      : 'Starke Ersparnis nach Preis pro Einheit',
    strictCandidateCount: strictDeals.length,
    fallbackCandidateCount: retailerFallbackDeals.length,
    filters: {
      category: filters.category,
      retailer: filters.retailer,
      invalid: filters.invalid,
    },
    availableFilters,
    deals: uniqueDeals.slice(0, safeLimit),
    excludedReasons,
    fallbackExcludedReasons,
    methodology: {
      primarySort: useRetailerFallback ? 'verified-discount-percent' : 'verified-unit-savings-percent',
      secondarySort: useRetailerFallback ? 'absolute-pack-savings' : 'absolute-unit-price-savings',
      tertiarySort: useRetailerFallback ? 'image-then-lower-current-price' : 'lower-current-unit-price',
      referencePrice: useRetailerFallback
        ? 'direct-source-reference-or-explicit-high-confidence-product-percent'
        : 'direct-source-reference-only',
      fewerThanLimitAllowed: true,
    },
  };
  if (profile) {
    profile.responseMappingMs = timingNowMs() - responseStartedAt;
    profile.strictAccepted = accepted.length;
    profile.strictUnique = uniqueGuardedDeals.length;
    profile.fallbackAccepted = fallbackAccepted.length;
    profile.fallbackUnique = uniqueFallbackDeals.length;
    profile.totalMs = timingNowMs() - profile.startedAt;
    response.debugTiming = Object.fromEntries(
      Object.entries(profile).map(([key, value]) => [key, typeof value === 'number' ? Number(value.toFixed(1)) : value])
    );
  }
  Object.defineProperty(response, '_cacheValidUntilMs', {
    value: cacheValidUntilMs,
    enumerable: false,
  });
  return response;
}

async function buildTopDeals({
  limit = DEFAULT_TOP_DEALS_LIMIT,
  now = new Date(),
  category = '',
  retailer = '',
  debugTiming = false,
} = {}) {
  const startedAt = timingNowMs();
  const safeLimit = normalizeLimit(limit);
  const filters = normalizeTopDealsFilters({ category, retailer });
  const cacheKey = [safeLimit, filters.category, filters.retailer, filters.invalid].join('|');
  const nowMs = now.getTime();
  const cachedEntry = cachedTopDeals.get(cacheKey);
  if (!debugTiming && cachedEntry && cachedEntry.expiresAt > nowMs) {
    return cachedEntry.response;
  }

  const inFlight = topDealsBuildPromises.get(cacheKey);
  if (!debugTiming && inFlight?.generation === topDealsCacheGeneration) {
    return inFlight.promise;
  }

  const generation = topDealsCacheGeneration;
  const buildPromise = (async () => {
    const mongoStartedAt = timingNowMs();
    const offers = debugTiming
      ? await readTopDealsCandidatePool({ publish: false })
      : await getTopDealsCandidatePool();
    const mongoReadMs = timingNowMs() - mongoStartedAt;

    const response = buildTopDealsFromOffers(offers, {
      limit: safeLimit,
      now,
      category,
      retailer,
      debugTiming,
      rankedMemo: debugTiming ? null : getTopDealsRankedMemo(now),
    });
    if (debugTiming) {
      response.debugTiming = {
        ...(response.debugTiming || {}),
        mongoReadMs: Number(mongoReadMs.toFixed(1)),
        totalMs: Number((timingNowMs() - startedAt).toFixed(1)),
      };
    } else if (generation === topDealsCacheGeneration) {
      cachedTopDeals.set(cacheKey, {
        expiresAt: Math.min(
          nowMs + TOP_DEALS_CACHE_TTL_MS,
          Number(response._cacheValidUntilMs || nowMs)
        ),
        response,
      });
    }
    return response;
  })();

  const buildEntry = { generation, promise: buildPromise };
  if (!debugTiming) topDealsBuildPromises.set(cacheKey, buildEntry);
  try {
    return await buildPromise;
  } finally {
    if (!debugTiming && topDealsBuildPromises.get(cacheKey) === buildEntry) {
      topDealsBuildPromises.delete(cacheKey);
    }
  }
}

function clearTopDealsCache() {
  topDealsCacheGeneration += 1;
  cachedTopDeals.clear();
  topDealsBuildPromises.clear();
  topDealsCandidatePool = null;
  topDealsCandidatePoolPromise = null;
  topDealsCandidatePoolDateKey = '';
  topDealsRankedMemoDateKey = '';
  topDealsRankedMemo = new WeakMap();
}

module.exports = {
  buildAvailableFilters,
  buildCandidateDecision,
  buildRetailerFallbackDecision,
  buildTopDeals,
  buildTopDealsFromOffers,
  clearTopDealsCache,
  compareTopDeals,
  compareRetailerFallbackDeals,
  matchesTopDealsFilters,
  normalizeLimit,
  normalizeTopDealsFilters,
  _private: {
    getTopDealsCandidatePool,
    getViennaDateKey,
  },
};
