const fs = require('node:fs');
const path = require('node:path');
const { normalizeTitleForMatch } = require('../crawl/sourceEvidence');

const TARGET_RETAILERS = [
  { retailerKey: 'penny', retailerName: 'PENNY' },
  { retailerKey: 'billa', retailerName: 'BILLA' },
  { retailerKey: 'billa-plus', retailerName: 'BILLA PLUS' },
  { retailerKey: 'spar', retailerName: 'SPAR / INTERSPAR / EUROSPAR' },
  { retailerKey: 'lidl', retailerName: 'LIDL' },
  { retailerKey: 'hofer', retailerName: 'HOFER' },
  { retailerKey: 'dm', retailerName: 'dm' },
  { retailerKey: 'bipa', retailerName: 'BIPA' },
  { retailerKey: 'adeg', retailerName: 'Adeg' },
];

const STOP_WORDS = new Set([
  'ab',
  'aktion',
  'angebot',
  'artikel',
  'bei',
  'bio',
  'der',
  'die',
  'das',
  'den',
  'dem',
  'des',
  'div',
  'eine',
  'einer',
  'extra',
  'fur',
  'fuer',
  'gratis',
  'je',
  'kg',
  'l',
  'liter',
  'mit',
  'nur',
  'oder',
  'pack',
  'packung',
  'pro',
  'sorten',
  'statt',
  'stueck',
  'stk',
  'und',
  'versch',
  'verschiedene',
  'von',
  'zum',
]);

const SOURCE_PRIORITY_MATRIX = {
  billa: [
    ['billa-official-algolia', 1, 'official-structured-json'],
    ['billa-official-html', 2, 'official-html'],
    ['aktionsfinder-json', 4, 'aggregator-json'],
  ],
  'billa-plus': [
    ['billa-official-algolia', 1, 'official-structured-json'],
    ['billa-official-html', 2, 'official-html'],
    ['aktionsfinder-json', 4, 'aggregator-json'],
  ],
  lidl: [
    ['lidl-official-flyer-api', 1, 'official-structured-json'],
    ['lidl-official-html', 2, 'official-html'],
    ['aktionsfinder-json', 4, 'aggregator-json'],
  ],
  penny: [
    ['penny-official-html', 1, 'official-html'],
    ['aktionsfinder-json', 3, 'aggregator-json'],
    ['penny-official-pdf', 8, 'pdf-evidence-only'],
    ['penny-pdf-ocr-bbox', 99, 'ocr-diagnostic-only'],
    ['penny-ocr-diagnostics', 99, 'ocr-diagnostic-only'],
  ],
  dm: [
    ['dm-official-html', 1, 'official-html'],
    ['aktionsfinder-json', 3, 'aggregator-json'],
    ['wogibtswas-html', 5, 'aggregator-html-supplemental'],
  ],
  bipa: [
    ['bipa-official-html', 1, 'official-html-target-primary'],
    ['aktionsfinder-json', 3, 'aggregator-json-current-primary'],
  ],
  spar: [
    ['spar-official-html', 1, 'official-html'],
    ['aktionsfinder-json', 3, 'aggregator-json-current-primary'],
  ],
  hofer: [
    ['hofer-official-html', 1, 'official-html'],
    ['aktionsfinder-json', 3, 'aggregator-json-current-primary'],
  ],
  adeg: [
    ['aktionsfinder-json', 4, 'aggregator-json-unproven'],
    ['adeg-official-html', 5, 'official-html-unproven'],
  ],
};

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function cents(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) : null;
}

function numberKey(value, digits = 3) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : '';
}

function dateKey(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function dateValue(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeKey(value) {
  return normalizeTitleForMatch(value).replace(/\s+/g, '-');
}

function normalizedTitle(offer = {}) {
  return normalizeTitleForMatch(offer.titleNormalized || offer.title || '');
}

function titleTokens(value) {
  return normalizeTitleForMatch(value)
    .split(/\s+/)
    .filter((token) => token.length >= 3)
    .filter((token) => !STOP_WORDS.has(token))
    .filter((token) => !/^\d+$/.test(token));
}

function offerTokens(offer = {}) {
  return titleTokens(`${offer.brand || ''} ${offer.titleNormalized || offer.title || ''}`);
}

function jaccard(leftTokens = [], rightTokens = []) {
  const left = new Set(leftTokens);
  const right = new Set(rightTokens);

  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;

  return union > 0 ? intersection / union : 0;
}

function validityOverlap(left = {}, right = {}) {
  const leftFrom = dateValue(left.validFrom);
  const leftTo = dateValue(left.validTo);
  const rightFrom = dateValue(right.validFrom);
  const rightTo = dateValue(right.validTo);

  if (leftFrom && leftTo && rightFrom && rightTo) {
    return leftFrom <= rightTo && rightFrom <= leftTo;
  }

  return false;
}

function hasSameValidity(left = {}, right = {}) {
  return dateKey(left.validFrom) === dateKey(right.validFrom)
    && dateKey(left.validTo) === dateKey(right.validTo)
    && Boolean(dateKey(left.validFrom) || dateKey(left.validTo));
}

function samePrice(left = {}, right = {}) {
  const leftCents = cents(left.priceCurrent?.amount);
  const rightCents = cents(right.priceCurrent?.amount);

  return leftCents !== null && rightCents !== null && Math.abs(leftCents - rightCents) <= 1;
}

function priceConflict(left = {}, right = {}) {
  const leftCents = cents(left.priceCurrent?.amount);
  const rightCents = cents(right.priceCurrent?.amount);

  return leftCents !== null && rightCents !== null && Math.abs(leftCents - rightCents) > 1;
}

function sameUnitPrice(left = {}, right = {}) {
  const leftAmount = Number(left.normalizedUnitPrice?.amount);
  const rightAmount = Number(right.normalizedUnitPrice?.amount);
  const leftUnit = normalizeKey(left.normalizedUnitPrice?.unit || left.comparableUnit || '');
  const rightUnit = normalizeKey(right.normalizedUnitPrice?.unit || right.comparableUnit || '');

  if (!Number.isFinite(leftAmount) || !Number.isFinite(rightAmount) || !leftUnit || !rightUnit || leftUnit !== rightUnit) {
    return false;
  }

  return Math.abs(leftAmount - rightAmount) / Math.max(leftAmount, rightAmount) <= 0.005;
}

function quantitySignature(offer = {}) {
  return [
    numberKey(offer.packCount, 0),
    numberKey(offer.unitValue, 3),
    normalizeKey(offer.unitType || ''),
    numberKey(offer.totalComparableAmount, 3),
    normalizeKey(offer.comparableUnit || offer.normalizedUnitPrice?.unit || ''),
    normalizeKey(offer.packageType || ''),
  ].join('|');
}

function quantityTextSignature(offer = {}) {
  const text = normalizeTitleForMatch(`${offer.quantityText || ''} ${offer.title || ''}`);
  const matches = [...text.matchAll(/\b(\d+(?:[,.]\d+)?)\s*(kg|g|l|ml|cl|stk|stueck|stuck|tabs|kapseln)\b/g)]
    .map((match) => `${Number(String(match[1]).replace(',', '.'))}:${match[2] === 'stuck' ? 'stueck' : match[2]}`);

  return uniq(matches).sort().join('|');
}

function quantityConflict(left = {}, right = {}) {
  const leftSignature = quantitySignature(left);
  const rightSignature = quantitySignature(right);
  const leftHasStructuredQuantity = /[1-9]/.test(leftSignature);
  const rightHasStructuredQuantity = /[1-9]/.test(rightSignature);

  if (leftHasStructuredQuantity && rightHasStructuredQuantity && leftSignature !== rightSignature) {
    return true;
  }

  const leftText = quantityTextSignature(left);
  const rightText = quantityTextSignature(right);

  return Boolean(leftText && rightText && leftText !== rightText);
}

function sameQuantity(left = {}, right = {}) {
  const leftSignature = quantitySignature(left);
  const rightSignature = quantitySignature(right);

  if (/[1-9]/.test(leftSignature) && leftSignature === rightSignature) {
    return true;
  }

  const leftText = quantityTextSignature(left);
  const rightText = quantityTextSignature(right);

  return Boolean(leftText && leftText === rightText);
}

function categoryCompatible(left = {}, right = {}) {
  const leftCategory = normalizeKey(left.subcategoryKey || left.categoryKey || '');
  const rightCategory = normalizeKey(right.subcategoryKey || right.categoryKey || '');

  return Boolean(!leftCategory || !rightCategory || leftCategory === rightCategory);
}

function categoryConflict(left = {}, right = {}) {
  const leftCategory = normalizeKey(left.subcategoryKey || left.categoryKey || '');
  const rightCategory = normalizeKey(right.subcategoryKey || right.categoryKey || '');

  return Boolean(leftCategory && rightCategory && leftCategory !== rightCategory);
}

function sharedTokens(left = {}, right = {}) {
  const rightSet = new Set(offerTokens(right));
  return uniq(offerTokens(left).filter((token) => rightSet.has(token))).sort();
}

function closePrice(left = {}, right = {}) {
  const leftCents = cents(left.priceCurrent?.amount);
  const rightCents = cents(right.priceCurrent?.amount);

  if (leftCents === null || rightCents === null) {
    return false;
  }

  const delta = Math.abs(leftCents - rightCents);
  return delta <= 25 || delta / Math.max(leftCents, rightCents) <= 0.08;
}

function priceDelta(left = {}, right = {}) {
  const leftAmount = Number(left.priceCurrent?.amount);
  const rightAmount = Number(right.priceCurrent?.amount);

  if (!Number.isFinite(leftAmount) || !Number.isFinite(rightAmount)) {
    return null;
  }

  return Number(Math.abs(leftAmount - rightAmount).toFixed(2));
}

function hasAnyValidity(offer = {}) {
  return Boolean(dateKey(offer.validFrom) || dateKey(offer.validTo));
}

function validityCompatible(left = {}, right = {}) {
  if (!hasAnyValidity(left) || !hasAnyValidity(right)) {
    return true;
  }

  return validityOverlap(left, right) || hasSameValidity(left, right);
}

function validityConflict(left = {}, right = {}) {
  return hasAnyValidity(left) && hasAnyValidity(right) && !validityCompatible(left, right);
}

function hasVariantConflict(left = {}, right = {}) {
  const leftTokens = new Set(offerTokens(left));
  const rightTokens = new Set(offerTokens(right));
  const leftOnly = [...leftTokens].filter((token) => !rightTokens.has(token));
  const rightOnly = [...rightTokens].filter((token) => !leftTokens.has(token));

  if (leftOnly.length === 0 || rightOnly.length === 0) {
    return false;
  }

  const shared = [...leftTokens].filter((token) => rightTokens.has(token));

  return shared.length >= 1 && leftOnly.length <= 3 && rightOnly.length <= 3;
}

function isOcrSource(sourceType = '') {
  return /ocr|bbox|tesseract|paddle/i.test(String(sourceType));
}

function isAggregatorSource(sourceType = '') {
  return /aktionsfinder|wogibtswas|marketguru|aggregator/i.test(String(sourceType || ''));
}

function isOfficialSource(sourceType = '') {
  return /official|angebote-page|offers-page|flyer/i.test(String(sourceType || '')) && !isAggregatorSource(sourceType);
}

function sourcePriorityEntry(retailerKey, sourceType) {
  const entries = SOURCE_PRIORITY_MATRIX[retailerKey] || [];
  const exact = entries.find(([candidate]) => candidate === sourceType);

  if (exact) {
    return { sourceType: exact[0], rank: exact[1], role: exact[2] };
  }

  if (isOcrSource(sourceType)) {
    return { sourceType, rank: 99, role: 'ocr-diagnostic-only' };
  }

  if (/official.*(?:algolia|api|json)|(?:algolia|api|json).*official/i.test(sourceType)) {
    return { sourceType, rank: 2, role: 'official-structured-json' };
  }

  if (/official.*html|html.*official/i.test(sourceType)) {
    return { sourceType, rank: 3, role: 'official-html' };
  }

  if (/pdf/i.test(sourceType)) {
    return { sourceType, rank: 8, role: 'pdf-evidence-only' };
  }

  if (isAggregatorSource(sourceType)) {
    return { sourceType, rank: 5, role: 'aggregator' };
  }

  return { sourceType: sourceType || 'unknown', rank: 20, role: 'unknown' };
}

function compareSourcePriority(retailerKey, left = {}, right = {}) {
  const leftPriority = sourcePriorityEntry(retailerKey, left.sourceType || '');
  const rightPriority = sourcePriorityEntry(retailerKey, right.sourceType || '');

  if (leftPriority.rank !== rightPriority.rank) {
    return leftPriority.rank - rightPriority.rank;
  }

  const leftCompleteness = Number(left.quality?.completenessScore || 0);
  const rightCompleteness = Number(right.quality?.completenessScore || 0);

  if (rightCompleteness !== leftCompleteness) {
    return rightCompleteness - leftCompleteness;
  }

  const leftConfidence = Number(left.sourceConfidence || left.extractionConfidence || left.quality?.parsingConfidence || 0);
  const rightConfidence = Number(right.sourceConfidence || right.extractionConfidence || right.quality?.parsingConfidence || 0);

  if (rightConfidence !== leftConfidence) {
    return rightConfidence - leftConfidence;
  }

  return String(left._id || '').localeCompare(String(right._id || ''));
}

function pickWinningOffer(offers = [], retailerKey = '') {
  return [...offers]
    .filter((offer) => !isOcrSource(offer.sourceType))
    .sort((left, right) => compareSourcePriority(retailerKey, left, right))[0]
    || [...offers].sort((left, right) => compareSourcePriority(retailerKey, left, right))[0]
    || null;
}

function buildOfferPreview(offer = {}) {
  return {
    id: String(offer._id || ''),
    title: offer.title || '',
    titleNormalized: normalizedTitle(offer),
    brand: offer.brand || '',
    priceCurrent: offer.priceCurrent?.amount ?? null,
    normalizedUnitPrice: offer.normalizedUnitPrice?.amount ?? null,
    normalizedUnit: offer.normalizedUnitPrice?.unit || offer.comparableUnit || '',
    quantityText: offer.quantityText || '',
    unitValue: offer.unitValue ?? null,
    unitType: offer.unitType || '',
    totalComparableAmount: offer.totalComparableAmount ?? null,
    validFrom: dateKey(offer.validFrom),
    validTo: dateKey(offer.validTo),
    categoryKey: offer.categoryKey || '',
    subcategoryKey: offer.subcategoryKey || '',
    sourceType: offer.sourceType || '',
    sourceUrl: offer.sourceUrl || '',
    offerKey: offer.offerKey || '',
    dedupeKey: offer.dedupeKey || '',
    comparisonGroup: offer.comparisonGroup || '',
  };
}

function buildCandidatePreview(left = {}, right = {}, classificationResult = {}) {
  return {
    retailerKey: left.retailerKey || right.retailerKey || '',
    sourceTypeA: left.sourceType || '',
    sourceTypeB: right.sourceType || '',
    titleA: left.title || '',
    titleB: right.title || '',
    normalizedTitleA: normalizedTitle(left),
    normalizedTitleB: normalizedTitle(right),
    sharedTokens: classificationResult.sharedTokens || sharedTokens(left, right),
    tokenOverlapScore: classificationResult.titleSimilarity ?? Number(jaccard(offerTokens(left), offerTokens(right)).toFixed(3)),
    priceA: left.priceCurrent?.amount ?? null,
    priceB: right.priceCurrent?.amount ?? null,
    priceDelta: priceDelta(left, right),
    validityA: { validFrom: dateKey(left.validFrom), validTo: dateKey(left.validTo) },
    validityB: { validFrom: dateKey(right.validFrom), validTo: dateKey(right.validTo) },
    categoryA: { categoryKey: left.categoryKey || '', subcategoryKey: left.subcategoryKey || '' },
    categoryB: { categoryKey: right.categoryKey || '', subcategoryKey: right.subcategoryKey || '' },
    quantityA: {
      quantityText: left.quantityText || '',
      unitValue: left.unitValue ?? null,
      unitType: left.unitType || '',
      totalComparableAmount: left.totalComparableAmount ?? null,
      comparableUnit: left.comparableUnit || left.normalizedUnitPrice?.unit || '',
    },
    quantityB: {
      quantityText: right.quantityText || '',
      unitValue: right.unitValue ?? null,
      unitType: right.unitType || '',
      totalComparableAmount: right.totalComparableAmount ?? null,
      comparableUnit: right.comparableUnit || right.normalizedUnitPrice?.unit || '',
    },
    classification: classificationResult.classification || classificationResult.matchStrength || 'weak',
    reasonCodes: classificationResult.reasonCodes || [],
    whyNotStrong: classificationResult.whyNotStrong || classificationResult.whyNotMerged || [],
  };
}

function evaluatePair(left = {}, right = {}) {
  if (!left.retailerKey || left.retailerKey !== right.retailerKey) {
    return null;
  }

  if (!left.sourceType || !right.sourceType || left.sourceType === right.sourceType) {
    return null;
  }

  const reasonCodes = ['same-retailer', 'cross-source'];
  const leftTitle = normalizedTitle(left);
  const rightTitle = normalizedTitle(right);
  const shared = sharedTokens(left, right);
  const similarity = jaccard(offerTokens(left), offerTokens(right));
  const exactTitle = Boolean(leftTitle && leftTitle === rightTitle);
  const overlap = validityOverlap(left, right);
  const sameValidity = hasSameValidity(left, right);
  const sameCurrentPrice = samePrice(left, right);
  const similarCurrentPrice = closePrice(left, right);
  const sameNormalizedUnitPrice = sameUnitPrice(left, right);
  const sameCategory = categoryCompatible(left, right);
  const hasCategoryConflict = categoryConflict(left, right);
  const sameBrand = Boolean(normalizeKey(left.brand || '') && normalizeKey(left.brand || '') === normalizeKey(right.brand || ''));
  const sameQty = sameQuantity(left, right);
  const qtyConflict = quantityConflict(left, right);
  const variantConflict = hasVariantConflict(left, right);
  const hasPriceConflict = priceConflict(left, right);
  const hasValidityConflict = validityConflict(left, right);
  const sharedComparisonGroup = Boolean(left.comparisonGroup && left.comparisonGroup === right.comparisonGroup);
  const sharedDedupeKey = Boolean(left.dedupeKey && left.dedupeKey === right.dedupeKey);
  const sharedOfferKey = Boolean(left.offerKey && left.offerKey === right.offerKey);

  if (exactTitle) reasonCodes.push('exact-normalized-title');
  if (shared.length >= 2) reasonCodes.push('shared-product-tokens');
  if (similarity >= 0.72) reasonCodes.push('token-overlap-high');
  if (sameCurrentPrice) reasonCodes.push('same-price');
  if (!sameCurrentPrice && similarCurrentPrice) reasonCodes.push('similar-price');
  if (sameNormalizedUnitPrice) reasonCodes.push('same-normalized-unit-price');
  if (overlap) reasonCodes.push('validity-overlap');
  if (sameValidity) reasonCodes.push('same-validity-window');
  if (sameCategory) reasonCodes.push('category-compatible');
  if (hasCategoryConflict) reasonCodes.push('category-conflict');
  if (sameBrand) reasonCodes.push('same-brand');
  if (sameQty) reasonCodes.push('same-quantity');
  if (sharedComparisonGroup) reasonCodes.push('same-comparison-group');
  if (sharedDedupeKey) reasonCodes.push('same-dedupe-key');
  if (sharedOfferKey) reasonCodes.push('same-offer-key');
  if (qtyConflict) reasonCodes.push('quantity-conflict');
  if (variantConflict) reasonCodes.push('variant-conflict');
  if (hasPriceConflict) reasonCodes.push('price-conflict');
  if (hasValidityConflict) reasonCodes.push('validity-conflict');

  const hasStrongIdentity = sharedDedupeKey || sharedOfferKey || sharedComparisonGroup || exactTitle || similarity >= 0.82;
  const hasLooseIdentity = hasStrongIdentity || shared.length >= 2 || similarity >= 0.38;
  const hasTemporalSignal = overlap || sameValidity;
  const hasTemporalCompatibility = validityCompatible(left, right);
  const hasPriceSignal = sameCurrentPrice || sameNormalizedUnitPrice;
  const hasLoosePriceSignal = hasPriceSignal || similarCurrentPrice || cents(left.priceCurrent?.amount) === null || cents(right.priceCurrent?.amount) === null;

  if (!hasLooseIdentity) {
    return null;
  }

  let classification = 'weak';
  const whyNotStrong = [];

  if (qtyConflict) {
    whyNotStrong.push('Packungs-/Mengenfelder widersprechen sich.');
  }

  if (variantConflict && !sharedDedupeKey && !sharedOfferKey && !sharedComparisonGroup) {
    whyNotStrong.push('Titel enthalten unterschiedliche moegliche Produktvarianten.');
  }

  if (hasPriceConflict && !(sharedDedupeKey || sharedOfferKey || sharedComparisonGroup)) {
    whyNotStrong.push('Preise unterscheiden sich ohne ausreichend starkes gemeinsames Produktfeld.');
  }

  if (!hasPriceSignal) {
    whyNotStrong.push('Kein gleicher Preis oder normalisierter Einheitspreis.');
  }

  if (!sameQty && !sharedComparisonGroup && !sharedDedupeKey) {
    whyNotStrong.push('Menge/Einheit ist nicht sicher gleich.');
  }

  if (hasValidityConflict) {
    whyNotStrong.push('Gueltigkeitszeitraeume ueberschneiden sich nicht.');
  }

  if (hasCategoryConflict) {
    whyNotStrong.push('Kategorie/Subkategorie widerspricht sich.');
  }

  if (
    hasPriceSignal
    && hasTemporalCompatibility
    && sameCategory
    && !qtyConflict
    && !variantConflict
    && (sameQty || sharedComparisonGroup || sharedDedupeKey || sharedOfferKey)
    && (exactTitle || sharedDedupeKey || sharedOfferKey || sharedComparisonGroup || similarity >= 0.9)
  ) {
    classification = 'strong';
  } else if (
    hasLoosePriceSignal
    && hasTemporalCompatibility
    && sameCategory
    && !qtyConflict
    && !variantConflict
    && (exactTitle || sharedComparisonGroup || shared.length >= 2 || similarity >= 0.62)
  ) {
    classification = hasPriceSignal ? 'medium' : 'weak';
  }

  if (qtyConflict || (variantConflict && !sharedDedupeKey && !sharedOfferKey && !sharedComparisonGroup)) {
    classification = 'needsReview';
  }

  if (
    (hasValidityConflict && hasPriceConflict)
    || (hasCategoryConflict && hasPriceConflict)
    || (hasCategoryConflict && shared.length < 2 && !hasStrongIdentity)
  ) {
    classification = 'reject';
  }

  const preview = buildCandidatePreview(left, right, {
    classification,
    reasonCodes: uniq(reasonCodes),
    sharedTokens: shared,
    titleSimilarity: Number(similarity.toFixed(3)),
    whyNotStrong: uniq(whyNotStrong),
  });

  return {
    pairKey: [String(left._id), String(right._id)].sort().join('::'),
    classification,
    matchStrength: classification,
    reasonCodes: uniq(reasonCodes),
    sharedTokens: shared,
    titleSimilarity: Number(similarity.toFixed(3)),
    normalizedTitles: [leftTitle, rightTitle],
    priceComparison: {
      samePrice: sameCurrentPrice,
      leftPrice: left.priceCurrent?.amount ?? null,
      rightPrice: right.priceCurrent?.amount ?? null,
      sameNormalizedUnitPrice,
      leftUnitPrice: left.normalizedUnitPrice?.amount ?? null,
      rightUnitPrice: right.normalizedUnitPrice?.amount ?? null,
      unit: left.normalizedUnitPrice?.unit || right.normalizedUnitPrice?.unit || '',
    },
    validityOverlap: {
      overlaps: overlap,
      sameWindow: sameValidity,
      left: { from: dateKey(left.validFrom), to: dateKey(left.validTo) },
      right: { from: dateKey(right.validFrom), to: dateKey(right.validTo) },
    },
    whyNotStrong: uniq(whyNotStrong),
    whyNotMerged: uniq(whyNotStrong),
    preview,
  };
}

function bucketKeysForOffer(offer = {}) {
  const retailer = normalizeKey(offer.retailerKey || '');
  const category = normalizeKey(offer.subcategoryKey || offer.categoryKey || '');
  const title = normalizedTitle(offer);
  const tokens = offerTokens(offer).slice(0, 5);
  const stableKeys = [
    offer.dedupeKey,
    offer.offerKey,
    offer.comparisonGroup,
    title,
    `${category}:${tokens.slice(0, 3).join('-')}`,
    `${category}:${normalizeKey(offer.brand || '')}:${numberKey(offer.priceCurrent?.amount, 2)}`,
    `${category}:${tokens.slice(0, 2).join('-')}`,
    ...tokens.slice(0, 4).map((token) => `${category}:${token}`),
  ].filter(Boolean).map(normalizeKey);

  return uniq(stableKeys).map((key) => `${retailer}::${key}`);
}

function buildCandidatePairs(offers = []) {
  const buckets = new Map();
  const pairKeys = new Set();
  const pairs = [];

  for (const offer of offers) {
    for (const key of bucketKeysForOffer(offer)) {
      if (!buckets.has(key)) {
        buckets.set(key, []);
      }

      buckets.get(key).push(offer);
    }
  }

  for (const bucketOffers of buckets.values()) {
    if (bucketOffers.length < 2 || bucketOffers.length > 140) {
      continue;
    }

    for (let leftIndex = 0; leftIndex < bucketOffers.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < bucketOffers.length; rightIndex += 1) {
        const left = bucketOffers[leftIndex];
        const right = bucketOffers[rightIndex];
        const pairKey = [String(left._id), String(right._id)].sort().join('::');

        if (left.retailerKey !== right.retailerKey || left.sourceType === right.sourceType) {
          continue;
        }

        if (pairKeys.has(pairKey)) {
          continue;
        }

        pairKeys.add(pairKey);
        pairs.push([left, right]);
      }
    }
  }

  return pairs;
}

function strengthRank(value) {
  return { strong: 5, medium: 4, weak: 3, needsReview: 2, reject: 1 }[value] ?? 0;
}

function groupPairs(offers = [], evaluatedPairs = []) {
  const offerMap = new Map(offers.map((offer) => [String(offer._id), offer]));
  const parent = new Map(offers.map((offer) => [String(offer._id), String(offer._id)]));

  function find(id) {
    const current = parent.get(id);
    if (!current || current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  }

  function union(leftId, rightId) {
    const leftRoot = find(leftId);
    const rightRoot = find(rightId);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  }

  for (const pair of evaluatedPairs.filter((item) => item.classification !== 'reject')) {
    const [leftId, rightId] = pair.pairKey.split('::');
    union(leftId, rightId);
  }

  const pairByGroup = new Map();

  for (const pair of evaluatedPairs.filter((item) => item.classification !== 'reject')) {
    const [leftId] = pair.pairKey.split('::');
    const root = find(leftId);

    if (!pairByGroup.has(root)) {
      pairByGroup.set(root, []);
    }

    pairByGroup.get(root).push(pair);
  }

  return [...pairByGroup.entries()].map(([root, pairs]) => {
    const ids = uniq(pairs.flatMap((pair) => pair.pairKey.split('::')));
    const groupOffers = ids.map((id) => offerMap.get(id)).filter(Boolean);
    const retailerKey = groupOffers[0]?.retailerKey || '';
    const winner = pickWinningOffer(groupOffers, retailerKey);
    const strongestPair = [...pairs].sort((left, right) => strengthRank(right.matchStrength) - strengthRank(left.matchStrength))[0];
    const anyReview = pairs.some((pair) => pair.classification === 'needsReview');
    const anyStrong = pairs.some((pair) => pair.matchStrength === 'strong');
    const matchStrength = anyReview ? 'needsReview' : (anyStrong ? 'strong' : strongestPair?.classification || strongestPair?.matchStrength || 'weak');
    const losingOffers = groupOffers.filter((offer) => String(offer._id) !== String(winner?._id));
    const winningPriority = sourcePriorityEntry(retailerKey, winner?.sourceType || '');
    const losingPriorities = losingOffers.map((offer) => sourcePriorityEntry(retailerKey, offer.sourceType || ''));
    const winnerIsOfficial = isOfficialSource(winner?.sourceType);
    const hasLosingAggregator = losingOffers.some((offer) => isAggregatorSource(offer.sourceType));
    const winnerHasValidity = hasAnyValidity(winner);
    const losingAggregatorWithoutValidity = losingOffers.some((offer) => isAggregatorSource(offer.sourceType) && !hasAnyValidity(offer));
    const betterSourceQuality = losingPriorities.some((priority) => winningPriority.rank < priority.rank);

    return {
      groupId: `source-dedupe:${retailerKey}:${ids.sort().join(':')}`,
      retailerKey,
      matchStrength,
      reasonCodes: uniq(pairs.flatMap((pair) => pair.reasonCodes)).sort(),
      preferredSource: {
        sourceType: winner?.sourceType || '',
        sourceRank: winningPriority.rank,
        sourceRole: winningPriority.role,
      },
      winningSourceType: winner?.sourceType || '',
      losingSourceTypes: uniq(losingOffers.map((offer) => offer.sourceType)).sort(),
      suppressedSourceCandidates: losingOffers.map((offer) => ({
        ...buildOfferPreview(offer),
        sourceRank: sourcePriorityEntry(retailerKey, offer.sourceType || '').rank,
        sourceRole: sourcePriorityEntry(retailerKey, offer.sourceType || '').role,
      })),
      officialPreferredBecauseValidity: Boolean(winnerIsOfficial && hasLosingAggregator && winnerHasValidity && losingAggregatorWithoutValidity),
      officialPreferredBecauseSourceQuality: Boolean(winnerIsOfficial && hasLosingAggregator && betterSourceQuality),
      winnerOfferPreview: buildOfferPreview(winner),
      duplicateOfferPreviews: losingOffers.map(buildOfferPreview),
      titleSimilarity: Number((pairs.reduce((sum, pair) => sum + pair.titleSimilarity, 0) / Math.max(pairs.length, 1)).toFixed(3)),
      normalizedTitleInfo: uniq(groupOffers.map(normalizedTitle)),
      priceComparison: strongestPair?.priceComparison || {},
      validityOverlap: strongestPair?.validityOverlap || {},
      whyNotMerged: uniq(pairs.flatMap((pair) => pair.whyNotMerged)),
      whyNotStrong: uniq(pairs.flatMap((pair) => pair.whyNotStrong)),
    };
  });
}

function sourcePriorityMatrixForReport() {
  return Object.fromEntries(
    Object.entries(SOURCE_PRIORITY_MATRIX).map(([retailerKey, rows]) => [
      retailerKey,
      rows.map(([sourceType, rank, role]) => ({ sourceType, rank, role })),
    ])
  );
}

const FIELD_COVERAGE_CHECKS = {
  offerKey: (offer) => Boolean(offer.offerKey),
  dedupeKey: (offer) => Boolean(offer.dedupeKey),
  comparisonGroup: (offer) => Boolean(offer.comparisonGroup),
  titleNormalized: (offer) => Boolean(normalizedTitle(offer)),
  priceCurrent: (offer) => cents(offer.priceCurrent?.amount) !== null,
  normalizedUnitPrice: (offer) => Number.isFinite(Number(offer.normalizedUnitPrice?.amount)) && Boolean(offer.normalizedUnitPrice?.unit),
  validityWindow: (offer) => Boolean(dateKey(offer.validFrom) && dateKey(offer.validTo)),
  quantityUnit: (offer) => Boolean(
    offer.quantityText
    || offer.unitType
    || offer.comparableUnit
    || offer.normalizedUnitPrice?.unit
    || Number.isFinite(Number(offer.unitValue))
    || Number.isFinite(Number(offer.totalComparableAmount))
  ),
  categorySubcategory: (offer) => Boolean(offer.categoryKey || offer.subcategoryKey),
};

function buildFieldCoverage(offers = []) {
  const total = offers.length;

  return Object.fromEntries(
    Object.entries(FIELD_COVERAGE_CHECKS).map(([field, hasValue]) => {
      const present = offers.filter(hasValue).length;
      const percent = total > 0 ? Number(((present / total) * 100).toFixed(1)) : 0;

      return [field, { present, missing: total - present, percent }];
    })
  );
}

function buildFieldCoverageWarnings(fieldCoverage = {}) {
  const warnings = [];
  const thresholds = {
    titleNormalized: 80,
    priceCurrent: 80,
    normalizedUnitPrice: 50,
    validityWindow: 60,
    quantityUnit: 50,
    categorySubcategory: 70,
    comparisonGroup: 30,
    dedupeKey: 30,
  };

  for (const [field, threshold] of Object.entries(thresholds)) {
    const percent = Number(fieldCoverage[field]?.percent || 0);

    if (percent < threshold) {
      warnings.push(`${field} coverage low (${percent}%, threshold ${threshold}%).`);
    }
  }

  return warnings;
}

function countClassified(candidates = [], classification) {
  return candidates.filter((candidate) => candidate.classification === classification).length;
}

function buildZeroStrongReason({ candidates = [], fieldCoverage = {}, sourceTypes = [] } = {}) {
  if (countClassified(candidates, 'strong') > 0) {
    return '';
  }

  if (candidates.length === 0) {
    if (sourceTypes.length <= 1) {
      return 'Nur ein SourceType beobachtet; keine Cross-Source-Kandidaten moeglich.';
    }

    const warnings = buildFieldCoverageWarnings(fieldCoverage);
    return warnings.length > 0
      ? `Keine lockeren Cross-Source-Kandidaten; Feldabdeckung koennte Discovery bremsen: ${warnings.slice(0, 3).join(' ')}`
      : 'Keine lockeren Cross-Source-Kandidaten trotz ausreichender Basisfelder; aktuell keine erkennbare Cross-Source-Naehe.';
  }

  const topReasons = uniq(candidates.flatMap((candidate) => candidate.whyNotStrong || candidate.whyNotMerged || []));
  return topReasons.length > 0
    ? `Kandidaten vorhanden, aber nicht strong: ${topReasons.slice(0, 3).join(' ')}`
    : 'Kandidaten vorhanden, aber Preis, Menge oder Gueltigkeit reichen konservativ nicht fuer strong.';
}

function buildRetailerSection({ retailer, offers = [], groups = [], candidates = [] }) {
  const sourceTypes = uniq(offers.map((offer) => offer.sourceType)).sort();
  const strongGroups = groups.filter((group) => group.matchStrength === 'strong');
  const needsReviewGroups = groups.filter((group) => group.matchStrength === 'needsReview');
  const highRiskGroups = groups.filter((group) => group.reasonCodes.some((code) => ['quantity-conflict', 'variant-conflict', 'price-conflict'].includes(code)));
  const fieldCoverage = buildFieldCoverage(offers);
  const priorityRows = sourcePriorityMatrixForReport()[retailer.retailerKey] || [];
  const observedPriorityRows = priorityRows.filter((row) => sourceTypes.includes(row.sourceType));
  const recommendedPrimarySource = (observedPriorityRows[0] || priorityRows[0] || null)?.sourceType || '';
  const suppressedIds = new Set(groups.flatMap((group) =>
    (group.suppressedSourceCandidates || []).map((offer) => String(offer.id || ''))
  ));
  const aggregatorKept = offers
    .filter((offer) => isAggregatorSource(offer.sourceType))
    .filter((offer) => !suppressedIds.has(String(offer._id || '')));
  const officialPreferredBecauseValidity = groups.filter((group) => group.officialPreferredBecauseValidity);
  const officialPreferredBecauseSourceQuality = groups.filter((group) => group.officialPreferredBecauseSourceQuality);
  const variantsKeptGroups = groups.filter((group) =>
    group.matchStrength === 'needsReview'
    || group.reasonCodes.some((code) => ['quantity-conflict', 'variant-conflict', 'price-conflict'].includes(code))
  );
  const risks = [];
  const coverageWarnings = buildFieldCoverageWarnings(fieldCoverage);

  if (sourceTypes.length > 1) {
    risks.push('Mehrere SourceTypes beobachtet; Cross-Source-Dedupe vor produktiver Zusammenfuehrung pruefen.');
  }

  if (highRiskGroups.length > 0) {
    risks.push('Dubletten-Kandidaten mit Preis-, Varianten- oder Mengen-Konflikt vorhanden.');
  }

  if (sourceTypes.some(isOcrSource)) {
    risks.push('OCR-Angebote duerfen nie Gewinnerquelle sein.');
  }

  if (needsReviewGroups.length > strongGroups.length) {
    risks.push('Mehr Review- als Strong-Gruppen: Produktvarianten/Mengenfelder konservativ behandeln.');
  }

  if (coverageWarnings.length > 0) {
    risks.push('Feldabdeckung begrenzt Dedupe-Sicherheit.');
  }

  const nextActions = [
    strongGroups.length > 0
      ? 'Strong-Gruppen als erste produktive Regelkandidaten mit Source-Evidence pruefen.'
      : 'Mehr Cross-Source-Coverage sammeln, bevor produktive Dedupe-Regeln aktiviert werden.',
    needsReviewGroups.length > 0
      ? 'NeedsReview-Gruppen manuell auf Varianten- und Mengenfehler pruefen.'
      : '',
    sourceTypes.some(isOcrSource)
      ? 'OCR nur als Diagnose/Evidence behalten und aus Gewinnerlogik ausschliessen.'
      : '',
  ];

  return {
    retailerKey: retailer.retailerKey,
    retailerName: retailer.retailerName,
    offerCount: offers.length,
    sourceTypes,
    looseCandidatePairs: candidates.length,
    classifiedStrong: countClassified(candidates, 'strong'),
    classifiedMedium: countClassified(candidates, 'medium'),
    classifiedWeak: countClassified(candidates, 'weak'),
    classifiedNeedsReview: countClassified(candidates, 'needsReview'),
    classifiedReject: countClassified(candidates, 'reject'),
    duplicateGroupsDetected: groups.length,
    duplicateCandidateGroups: groups.length,
    strongDuplicateGroups: strongGroups.length,
    looseDuplicateGroups: groups.filter((group) => group.matchStrength !== 'strong').length,
    needsReviewGroups: needsReviewGroups.length,
    highRiskGroups: highRiskGroups.length,
    preferredSource: recommendedPrimarySource,
    recommendedPrimarySource,
    aggregatorKeptBecauseNoBetterSource: {
      count: aggregatorKept.length,
      examples: aggregatorKept.slice(0, 5).map(buildOfferPreview),
    },
    officialPreferredBecauseValidity: {
      count: officialPreferredBecauseValidity.length,
      examples: officialPreferredBecauseValidity.slice(0, 5),
    },
    officialPreferredBecauseSourceQuality: {
      count: officialPreferredBecauseSourceQuality.length,
      examples: officialPreferredBecauseSourceQuality.slice(0, 5),
    },
    variantsKept: {
      count: variantsKeptGroups.length,
      examples: variantsKeptGroups.slice(0, 5),
    },
    riskCasesNeedsReview: {
      count: needsReviewGroups.length,
      examples: needsReviewGroups.slice(0, 5),
    },
    topLooseCandidateExamples: candidates
      .filter((candidate) => candidate.classification !== 'reject')
      .sort((left, right) => strengthRank(right.classification) - strengthRank(left.classification) || right.titleSimilarity - left.titleSimilarity)
      .slice(0, 5)
      .map((candidate) => candidate.preview),
    topNeedsReviewExamples: candidates
      .filter((candidate) => candidate.classification === 'needsReview')
      .sort((left, right) => right.titleSimilarity - left.titleSimilarity)
      .slice(0, 5)
      .map((candidate) => candidate.preview),
    fieldCoverage,
    fieldCoverageWarnings: coverageWarnings,
    zeroStrongReason: buildZeroStrongReason({ candidates, fieldCoverage, sourceTypes }),
    topDuplicateExamples: [...groups]
      .sort((left, right) => strengthRank(right.matchStrength) - strengthRank(left.matchStrength))
      .slice(0, 5),
    risks,
    nextActions: uniq(nextActions),
  };
}

function buildSourceDedupeDiagnostic({ offers = [], generatedAt = new Date() } = {}) {
  const relevantOffers = offers.filter((offer) => offer?.retailerKey);
  const candidates = buildCandidatePairs(relevantOffers)
    .map(([left, right]) => evaluatePair(left, right))
    .filter(Boolean);
  const pairs = candidates.filter((candidate) => candidate.classification !== 'reject');
  const groups = groupPairs(relevantOffers, pairs)
    .sort((left, right) => strengthRank(right.matchStrength) - strengthRank(left.matchStrength));
  const groupsByRetailer = new Map();
  const offersByRetailer = new Map();
  const candidatesByRetailer = new Map();

  for (const offer of relevantOffers) {
    if (!offersByRetailer.has(offer.retailerKey)) {
      offersByRetailer.set(offer.retailerKey, []);
    }

    offersByRetailer.get(offer.retailerKey).push(offer);
  }

  for (const group of groups) {
    if (!groupsByRetailer.has(group.retailerKey)) {
      groupsByRetailer.set(group.retailerKey, []);
    }

    groupsByRetailer.get(group.retailerKey).push(group);
  }

  for (const candidate of candidates) {
    const retailerKey = candidate.preview?.retailerKey || '';

    if (!retailerKey) {
      continue;
    }

    if (!candidatesByRetailer.has(retailerKey)) {
      candidatesByRetailer.set(retailerKey, []);
    }

    candidatesByRetailer.get(retailerKey).push(candidate);
  }

  const retailers = TARGET_RETAILERS
    .filter((retailer) => offersByRetailer.has(retailer.retailerKey) || groupsByRetailer.has(retailer.retailerKey))
    .map((retailer) => buildRetailerSection({
      retailer,
      offers: offersByRetailer.get(retailer.retailerKey) || [],
      groups: groupsByRetailer.get(retailer.retailerKey) || [],
      candidates: candidatesByRetailer.get(retailer.retailerKey) || [],
    }));

  const strongDuplicateGroups = groups.filter((group) => group.matchStrength === 'strong').length;
  const looseDuplicateGroups = groups.filter((group) => group.matchStrength !== 'strong').length;
  const needsReviewGroups = groups.filter((group) => group.matchStrength === 'needsReview').length;
  const highRiskGroups = groups.filter((group) => group.reasonCodes.some((code) => ['quantity-conflict', 'variant-conflict', 'price-conflict'].includes(code))).length;
  const globalFieldCoverage = buildFieldCoverage(relevantOffers);
  const retailerSourceCounts = [...offersByRetailer.values()].filter((items) => uniq(items.map((offer) => offer.sourceType)).length > 1).length;
  const globalCoverageWarnings = buildFieldCoverageWarnings(globalFieldCoverage);
  const suppressedSourceCandidates = groups.flatMap((group) => group.suppressedSourceCandidates || []);
  const officialPreferredBecauseValidity = groups.filter((group) => group.officialPreferredBecauseValidity);
  const officialPreferredBecauseSourceQuality = groups.filter((group) => group.officialPreferredBecauseSourceQuality);
  const variantsKept = groups.filter((group) =>
    group.matchStrength === 'needsReview'
    || group.reasonCodes.some((code) => ['quantity-conflict', 'variant-conflict', 'price-conflict'].includes(code))
  );
  const suppressedIds = new Set(suppressedSourceCandidates.map((offer) => String(offer.id || '')));
  const aggregatorKeptBecauseNoBetterSource = relevantOffers
    .filter((offer) => isAggregatorSource(offer.sourceType))
    .filter((offer) => !suppressedIds.has(String(offer._id || '')));

  return {
    ok: true,
    readOnly: true,
    mutatedCollections: [],
    generatedAt: generatedAt instanceof Date ? generatedAt.toISOString() : generatedAt,
    principle: 'Qualitaet der Daten ist kein Nebenthema - sie IST das Produkt.',
    sourcePriorityMatrix: sourcePriorityMatrixForReport(),
    looseCandidateDiscovery: {
      totalCandidatePairs: candidates.length,
      nonRejectedCandidatePairs: pairs.length,
      rejectedCandidatePairs: countClassified(candidates, 'reject'),
    },
    strictClassification: {
      strong: countClassified(candidates, 'strong'),
      medium: countClassified(candidates, 'medium'),
      weak: countClassified(candidates, 'weak'),
      needsReview: countClassified(candidates, 'needsReview'),
      reject: countClassified(candidates, 'reject'),
    },
    fieldCoverage: globalFieldCoverage,
    fieldCoverageWarnings: globalCoverageWarnings,
    summary: {
      retailersAnalyzed: retailers.length,
      totalOffersAnalyzed: relevantOffers.length,
      crossSourceRetailers: retailerSourceCounts,
      looseCandidatePairs: candidates.length,
      classifiedStrong: countClassified(candidates, 'strong'),
      classifiedMedium: countClassified(candidates, 'medium'),
      classifiedWeak: countClassified(candidates, 'weak'),
      classifiedNeedsReview: countClassified(candidates, 'needsReview'),
      classifiedReject: countClassified(candidates, 'reject'),
      fieldCoverageWarnings: globalCoverageWarnings.length,
      duplicateGroupsDetected: groups.length,
      duplicateCandidateGroups: groups.length,
      strongDuplicateGroups,
      looseDuplicateGroups,
      needsReviewGroups,
      highRiskGroups,
      suppressedSourceCandidates: suppressedSourceCandidates.length,
      aggregatorKeptBecauseNoBetterSource: aggregatorKeptBecauseNoBetterSource.length,
      officialPreferredBecauseValidity: officialPreferredBecauseValidity.length,
      officialPreferredBecauseSourceQuality: officialPreferredBecauseSourceQuality.length,
      variantsKept: variantsKept.length,
      riskCasesNeedsReview: needsReviewGroups,
    },
    sourcePriority: {
      duplicateCandidateGroups: groups.length,
      strongDuplicateGroups,
      looseDuplicateGroups,
      preferredSource: Object.fromEntries(retailers.map((retailer) => [retailer.retailerKey, retailer.preferredSource])),
      suppressedSourceCandidates: suppressedSourceCandidates.slice(0, 20),
      aggregatorKeptBecauseNoBetterSource: {
        count: aggregatorKeptBecauseNoBetterSource.length,
        examples: aggregatorKeptBecauseNoBetterSource.slice(0, 20).map(buildOfferPreview),
      },
      officialPreferredBecauseValidity: {
        count: officialPreferredBecauseValidity.length,
        examples: officialPreferredBecauseValidity.slice(0, 10),
      },
      officialPreferredBecauseSourceQuality: {
        count: officialPreferredBecauseSourceQuality.length,
        examples: officialPreferredBecauseSourceQuality.slice(0, 10),
      },
      variantsKept: {
        count: variantsKept.length,
        examples: variantsKept.slice(0, 10),
      },
      riskCasesNeedsReview: {
        count: needsReviewGroups,
        examples: groups.filter((group) => group.matchStrength === 'needsReview').slice(0, 10),
      },
    },
    retailers,
  };
}

function writeDiagnosticArtifact(report, { baseDir = process.cwd(), generatedAt = new Date() } = {}) {
  const stamp = (generatedAt instanceof Date ? generatedAt : new Date(generatedAt))
    .toISOString()
    .replace(/[:.]/g, '-');
  const dir = path.join(baseDir, 'tmp', 'diagnostics', `source-dedupe-${stamp}`);
  const file = path.join(dir, 'source-dedupe.json');

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(report, null, 2));

  return file;
}

module.exports = {
  TARGET_RETAILERS,
  SOURCE_PRIORITY_MATRIX,
  buildSourceDedupeDiagnostic,
  sourcePriorityEntry,
  sourcePriorityMatrixForReport,
  evaluatePair,
  writeDiagnosticArtifact,
};
