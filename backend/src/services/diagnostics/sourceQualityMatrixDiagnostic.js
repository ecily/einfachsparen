const { detectPdfCategoryMismatchReviewSignal } = require('../crawl/pdfOfferParsing');
const { normalizeTitleForMatch } = require('../crawl/sourceEvidence');
const { isOfferSafelyComparable } = require('../crawl/offerQualityGuards');
const {
  calculateOfferQualityScore,
  hasCategoryContradiction,
  hasConditionSignal,
  hasQuantityArtifact,
  hasUnsafeUnitPrice,
} = require('../offers/offerQualityScore');
const { classifyOfferSourceQuality } = require('../offers/sourceQuality');

const TARGET_RETAILERS = [
  { key: 'billa', label: 'BILLA', aliases: ['billa'] },
  { key: 'billa-plus', label: 'BILLA Plus', aliases: ['billa-plus', 'billa plus'] },
  { key: 'spar', label: 'SPAR', aliases: ['spar'] },
  { key: 'eurospar', label: 'EUROSPAR', aliases: ['eurospar'] },
  { key: 'interspar', label: 'INTERSPAR', aliases: ['interspar'] },
  { key: 'hofer', label: 'HOFER', aliases: ['hofer'] },
  { key: 'lidl', label: 'Lidl', aliases: ['lidl'] },
  { key: 'penny', label: 'PENNY', aliases: ['penny'] },
  { key: 'bipa', label: 'BIPA', aliases: ['bipa'] },
  { key: 'dm', label: 'dm', aliases: ['dm'] },
  { key: 'pagro', label: 'PAGRO', aliases: ['pagro'] },
];

const TARGET_KEYS = new Set(TARGET_RETAILERS.map((retailer) => retailer.key));

function pct(part, total) {
  if (!total) return 0;
  return Number(((Number(part || 0) / Number(total || 0)) * 100).toFixed(1));
}

function normalizeKey(value) {
  return normalizeTitleForMatch(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function compact(values = []) {
  return values.map((value) => String(value || '').trim()).filter(Boolean);
}

function dateKey(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function priceAmount(offer = {}) {
  const amount = Number(offer.priceCurrent?.amount);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function hasTitleAndPrice(offer = {}) {
  return Boolean(String(offer.title || '').trim() && priceAmount(offer) !== null);
}

function hasImage(offer = {}) {
  return /^https?:\/\//i.test(String(offer.imageUrl || '').trim());
}

function hasBasePrice(offer = {}) {
  const amount = Number(offer.normalizedUnitPrice?.amount);
  return Number.isFinite(amount) && amount > 0 && Boolean(String(offer.normalizedUnitPrice?.unit || offer.comparableUnit || '').trim());
}

function collectIssueSignals(offer = {}) {
  return [
    ...(Array.isArray(offer.reviewReasons) ? offer.reviewReasons : []),
    ...(Array.isArray(offer.quality?.issues) ? offer.quality.issues : []),
  ].map((item) => String(item || '').trim()).filter(Boolean);
}

function hasQualityIssue(offer = {}) {
  return Boolean(offer.needsReview || collectIssueSignals(offer).length > 0);
}

function inferSourceKey(offer = {}, source = {}) {
  return compact([
    offer.rawFacts?.sourceKey,
    offer.rawFacts?.sourceMetadata?.sourceKey,
    source.sourceKey,
    source.label,
    offer.sourceType,
    source.sourceType,
    offer.sourceUrl,
    source.sourceUrl,
  ])[0] || 'unknown';
}

function inferSourceLabel(offer = {}, source = {}) {
  const sourceKey = inferSourceKey(offer, source);
  const sourceType = offer.sourceType || source.sourceType || offer.rawFacts?.sourceType || '';

  return compact([sourceKey, sourceType]).join(' / ') || 'unknown';
}

function inferRetailerKey(offer = {}, source = {}) {
  const format = normalizeKey(
    offer.sourceRetailerFormat ||
    source.sourceRetailerFormat ||
    offer.rawFacts?.sourceRetailerFormat ||
    ''
  );
  const formats = [
    ...(Array.isArray(offer.appliesToRetailerFormats) ? offer.appliesToRetailerFormats : []),
    ...(Array.isArray(source.appliesToRetailerFormats) ? source.appliesToRetailerFormats : []),
    ...(Array.isArray(offer.rawFacts?.appliesToRetailerFormats) ? offer.rawFacts.appliesToRetailerFormats : []),
  ].map(normalizeKey);
  const retailerKey = normalizeKey(offer.retailerKey || source.retailerKey || offer.retailerName || '');

  if (['spar', 'eurospar', 'interspar'].includes(format)) {
    return format;
  }

  const sparFormat = formats.find((item) => ['spar', 'eurospar', 'interspar'].includes(item));
  if (sparFormat) {
    return sparFormat;
  }

  return retailerKey;
}

function retailerLabel(retailerKey) {
  return TARGET_RETAILERS.find((retailer) => retailer.key === retailerKey)?.label || retailerKey || 'unknown';
}

function isTargetOffer(offer = {}, source = {}) {
  return TARGET_KEYS.has(inferRetailerKey(offer, source));
}

function hasPotentialCategoryContradiction(offer = {}) {
  if (hasCategoryContradiction(offer)) {
    return true;
  }

  return Boolean(detectPdfCategoryMismatchReviewSignal({
    sourceType: offer.sourceType,
    sourceKey: offer.rawFacts?.sourceKey,
    title: offer.title,
    categoryPrimary: offer.categoryPrimary,
    categorySecondary: offer.categorySecondary,
    categoryKey: offer.categoryKey,
  }));
}

function duplicateKey(offer = {}, sourceKey = '') {
  return [
    sourceKey,
    normalizeKey(offer.retailerKey || offer.retailerName || ''),
    normalizeTitleForMatch(offer.titleNormalized || offer.title || ''),
    priceAmount(offer) === null ? 'price:missing' : `price:${priceAmount(offer).toFixed(2)}`,
  ].join('|');
}

function quantityVariantKey(offer = {}) {
  return [
    normalizeTitleForMatch(offer.quantityText || ''),
    offer.unitValue ?? '',
    offer.unitType || '',
    offer.totalComparableAmount ?? '',
    offer.comparableUnit || offer.normalizedUnitPrice?.unit || '',
  ].join('|');
}

function createRow({ retailerKey, sourceLabel, sourceKey, sourceType }) {
  return {
    retailerKey,
    retailer: retailerLabel(retailerKey),
    source: sourceLabel,
    sourceKey,
    sourceType,
    count: 0,
    imageCount: 0,
    conditionCount: 0,
    basePriceCount: 0,
    safeBasePriceCount: 0,
    unsafeUnitPriceCount: 0,
    qualityIssueCount: 0,
    quantityArtifactCount: 0,
    missingTitleOrPriceCount: 0,
    categoryContradictionCount: 0,
    officialCount: 0,
    aggregatorCount: 0,
    duplicateBuckets: new Map(),
    scoreSum: 0,
  };
}

function addOfferToRow(row, offer = {}) {
  row.count += 1;
  if (hasImage(offer)) row.imageCount += 1;
  if (hasConditionSignal(offer)) row.conditionCount += 1;
  if (hasBasePrice(offer)) row.basePriceCount += 1;
  if (isOfferSafelyComparable(offer)) row.safeBasePriceCount += 1;
  if (hasUnsafeUnitPrice(offer)) row.unsafeUnitPriceCount += 1;
  if (hasQualityIssue(offer)) row.qualityIssueCount += 1;
  if (hasQuantityArtifact(offer)) row.quantityArtifactCount += 1;
  if (!hasTitleAndPrice(offer)) row.missingTitleOrPriceCount += 1;
  if (hasPotentialCategoryContradiction(offer)) row.categoryContradictionCount += 1;

  const sourceQuality = classifyOfferSourceQuality(offer);
  if (sourceQuality.hasOfficialEvidence || sourceQuality.sourceClass.startsWith('official')) row.officialCount += 1;
  if (['aggregator', 'aggregator-ppcv'].includes(sourceQuality.sourceClass)) row.aggregatorCount += 1;

  const key = duplicateKey(offer, row.sourceKey);
  if (!row.duplicateBuckets.has(key)) {
    row.duplicateBuckets.set(key, []);
  }
  row.duplicateBuckets.get(key).push({
    broken: hasQuantityArtifact(offer),
    quantityVariantKey: quantityVariantKey(offer),
  });

  row.scoreSum += calculateOfferQualityScore(offer).score;
}

function summarizeProblems(row) {
  const problems = [];

  if (pct(row.quantityArtifactCount, row.count) >= 3) problems.push('Mengenartefakte');
  if (pct(row.unsafeUnitPriceCount, row.count) >= 10) problems.push('unsichere Unit-Prices');
  if (pct(row.qualityIssueCount, row.count) >= 15) problems.push('Review-/Quality-Issues');
  if (pct(row.missingTitleOrPriceCount, row.count) >= 5) problems.push('Titel/Preis fehlt');
  if (pct(row.categoryContradictionCount, row.count) >= 2) problems.push('Kategorie-Widersprueche');
  if (pct(row.imageCount, row.count) < 35) problems.push('niedrige Bildquote');
  if (pct(row.conditionCount, row.count) < 10) problems.push('wenig Conditions');

  return problems.slice(0, 4);
}

function buildRecommendation(row, duplicateStats) {
  const problems = summarizeProblems(row);

  if (row.count === 0) return 'Keine aktiven Angebote in Stichprobe.';
  if (pct(row.missingTitleOrPriceCount, row.count) >= 10) return 'Quelle in Diagnostics markieren; Parser/Preisextraktion pruefen.';
  if (pct(row.quantityArtifactCount, row.count) >= 3 || pct(row.unsafeUnitPriceCount, row.count) >= 10) return 'Nicht loeschen; Unit-/Mengenfelder niedrig gewichten und Normalisierung pruefen.';
  if (duplicateStats.brokenVsCleanGroups > 0) return 'Dubletten mit kaputter vs. sauberer Menge weiter deduplizieren, ohne Source pauschal zu sperren.';
  if (pct(row.qualityIssueCount, row.count) >= 15) return 'Review-Signale fuer Ranking/Diagnostics nutzen; keine harte Filterung.';
  if (problems.length === 0) return 'Quelle als verlaesslich nutzbar; normale Gewichtung beibehalten.';

  return 'Beobachten und schwach gewichten; gezielte Parserdiagnose statt globalem Ausschluss.';
}

function finalizeRow(row) {
  let duplicateGroups = 0;
  let duplicateOfferCount = 0;
  let brokenVsCleanGroups = 0;

  for (const offers of row.duplicateBuckets.values()) {
    if (offers.length <= 1) {
      continue;
    }

    duplicateGroups += 1;
    duplicateOfferCount += offers.length;

    const hasBroken = offers.some((offer) => offer.broken);
    const hasClean = offers.some((offer) => !offer.broken);
    const quantityVariants = new Set(offers.map((offer) => offer.quantityVariantKey).filter(Boolean));

    if (hasBroken && hasClean && quantityVariants.size > 1) {
      brokenVsCleanGroups += 1;
    }
  }

  const duplicateStats = {
    duplicateGroups,
    duplicateOfferCount,
    brokenVsCleanGroups,
  };
  const problems = summarizeProblems(row);

  return {
    retailer: row.retailer,
    retailerKey: row.retailerKey,
    source: row.source,
    sourceKey: row.sourceKey,
    sourceType: row.sourceType,
    count: row.count,
    imageQuote: pct(row.imageCount, row.count),
    conditionQuote: pct(row.conditionCount, row.count),
    basePriceQuote: pct(row.basePriceCount, row.count),
    safeBasePriceQuote: pct(row.safeBasePriceCount, row.count),
    unsafeUnitPriceQuote: pct(row.unsafeUnitPriceCount, row.count),
    qualityIssueQuote: pct(row.qualityIssueCount, row.count),
    quantityArtifactQuote: pct(row.quantityArtifactCount, row.count),
    missingTitleOrPriceQuote: pct(row.missingTitleOrPriceCount, row.count),
    categoryContradictionQuote: pct(row.categoryContradictionCount, row.count),
    officialShare: pct(row.officialCount, row.count),
    aggregatorShare: pct(row.aggregatorCount, row.count),
    averageOfferQualityScore: row.count ? Number((row.scoreSum / row.count).toFixed(1)) : 0,
    duplicateSuspicion: duplicateStats,
    mainProblems: problems,
    recommendation: buildRecommendation(row, duplicateStats),
  };
}

function buildSourceQualityMatrixDiagnostic({
  offers = [],
  sources = [],
  generatedAt = new Date(),
  scope = 'active-now',
  dbAccess = true,
  fallback = '',
} = {}) {
  const sourcesById = new Map(sources.map((source) => [String(source._id || ''), source]));
  const rows = new Map();
  const relevantOffers = offers.filter((offer) => {
    const source = sourcesById.get(String(offer.sourceId || '')) || {};
    return isTargetOffer(offer, source);
  });

  for (const offer of relevantOffers) {
    const source = sourcesById.get(String(offer.sourceId || '')) || {};
    const retailerKey = inferRetailerKey(offer, source);
    const sourceKey = inferSourceKey(offer, source);
    const sourceType = offer.sourceType || source.sourceType || offer.rawFacts?.sourceType || '';
    const sourceLabel = inferSourceLabel(offer, source);
    const rowKey = [retailerKey, sourceKey, sourceType].join('|');

    if (!rows.has(rowKey)) {
      rows.set(rowKey, createRow({ retailerKey, sourceLabel, sourceKey, sourceType }));
    }

    addOfferToRow(rows.get(rowKey), offer);
  }

  const table = [...rows.values()]
    .map(finalizeRow)
    .sort((left, right) => left.retailer.localeCompare(right.retailer, 'de') || right.count - left.count || left.source.localeCompare(right.source, 'de'));

  return {
    ok: true,
    readOnly: true,
    mutatedCollections: [],
    generatedAt: generatedAt instanceof Date ? generatedAt.toISOString() : generatedAt,
    scope,
    dbAccess,
    fallback,
    retailersRequested: TARGET_RETAILERS.map((retailer) => retailer.label),
    summary: {
      offersAnalyzed: relevantOffers.length,
      sourceRows: table.length,
      rowsWithQuantityArtifacts: table.filter((row) => row.quantityArtifactQuote > 0).length,
      rowsWithUnsafeUnitPrices: table.filter((row) => row.unsafeUnitPriceQuote > 0).length,
      rowsWithQualityIssues: table.filter((row) => row.qualityIssueQuote > 0).length,
      duplicateSuspicionGroups: table.reduce((sum, row) => sum + row.duplicateSuspicion.duplicateGroups, 0),
      brokenVsCleanDuplicateGroups: table.reduce((sum, row) => sum + row.duplicateSuspicion.brokenVsCleanGroups, 0),
    },
    table,
  };
}

async function fetchSourceQualityMatrixInputs({ Offer, Source, activeOnly = true, maxTimeMS = 5000 } = {}) {
  const targetKeys = [...TARGET_KEYS];
  const match = activeOnly
    ? {
      status: 'active',
      isActiveNow: true,
      $or: [
        { retailerKey: { $in: targetKeys } },
        { sourceRetailerFormat: { $in: ['spar', 'eurospar', 'interspar'] } },
        { appliesToRetailerFormats: { $in: ['spar', 'eurospar', 'interspar'] } },
      ],
    }
    : {
      $or: [
        { retailerKey: { $in: targetKeys } },
        { sourceRetailerFormat: { $in: ['spar', 'eurospar', 'interspar'] } },
        { appliesToRetailerFormats: { $in: ['spar', 'eurospar', 'interspar'] } },
      ],
    };
  const offerSelect = [
    '_id',
    'retailerKey',
    'retailerName',
    'sourceId',
    'sourceType',
    'sourceTypes',
    'sourceUrl',
    'sourceUrls',
    'evidenceUrls',
    'sourceRetailerFormat',
    'appliesToRetailerFormats',
    'title',
    'titleNormalized',
    'brand',
    'categoryPrimary',
    'categorySecondary',
    'categoryKey',
    'subcategoryKey',
    'categoryConfidence',
    'subcategoryConfidence',
    'conditionsText',
    'hasConditions',
    'customerProgramRequired',
    'isMultiBuy',
    'minimumPurchaseQty',
    'imageUrl',
    'priceCurrent',
    'quantityText',
    'packCount',
    'unitValue',
    'unitType',
    'totalComparableAmount',
    'comparableUnit',
    'normalizedUnitPrice',
    'quality',
    'needsReview',
    'reviewReasons',
    'validFrom',
    'validTo',
    'rawFacts.sourceKey',
    'rawFacts.sourceMetadata',
    'rawFacts.sourceType',
    'rawFacts.sourceRetailerFormat',
    'rawFacts.appliesToRetailerFormats',
  ].join(' ');
  const offers = await Offer.find(match)
    .select(offerSelect)
    .maxTimeMS(maxTimeMS)
    .lean();
  const sourceIds = [...new Set(offers.map((offer) => String(offer.sourceId || '')).filter(Boolean))];
  const sources = Source && sourceIds.length > 0
    ? await Source.find({ _id: { $in: sourceIds } })
      .select('retailerKey retailerName channel label sourceRetailerFormat appliesToRetailerFormats sourceUrl sourceType')
      .maxTimeMS(maxTimeMS)
      .lean()
    : [];

  return { offers, sources };
}

module.exports = {
  TARGET_RETAILERS,
  buildSourceQualityMatrixDiagnostic,
  fetchSourceQualityMatrixInputs,
  inferRetailerKey,
  pct,
};
