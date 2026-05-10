const { RETAILER_DEFINITIONS } = require('../sources/sourceDefinitions');

const QUERY_MAX_TIME_MS = 2000;
const DEFAULT_LIMIT = 25;
const EXAMPLE_LIMIT = 5;

const CHECKED_RETAILERS = [
  { retailerKey: 'billa', displayName: 'BILLA' },
  { retailerKey: 'billa-plus', displayName: 'BILLA PLUS' },
  { retailerKey: 'hofer', displayName: 'HOFER' },
  { retailerKey: 'dm', displayName: 'dm' },
  { retailerKey: 'bipa', displayName: 'BIPA' },
  { retailerKey: 'lidl', displayName: 'LIDL' },
  { retailerKey: 'penny', displayName: 'PENNY' },
];

const INACTIVE_OFFICIAL_CONTEXT = [
  {
    retailerKey: 'spar',
    status: 'official-disabled-fixture-only',
    note: 'Official SPAR source is present in code but disabled; parser coverage is fixture-only and blocking risk remains. No SPAR fix logic is part of this diagnostic.',
  },
  {
    retailerKey: 'pagro',
    status: 'no-official-source-registered',
    note: 'PAGRO has no active official source registered and no official parser. It is context only in this diagnostic.',
  },
];

function pct(part, total) {
  if (!total) return 0;
  return Number(((Number(part || 0) / Number(total || 0)) * 100).toFixed(1));
}

function ratio(count, total) {
  return {
    count: Number(count || 0),
    total: Number(total || 0),
    pct: pct(count, total),
  };
}

function compact(values = []) {
  return values.map((value) => String(value || '').trim()).filter(Boolean);
}

function uniqueCompact(values = []) {
  return [...new Set(compact(values))];
}

function dateKey(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function textPresent(value) {
  return String(value || '').trim().length > 0;
}

function hasUsablePrice(offer = {}) {
  const amount = Number(offer.priceCurrent?.amount ?? offer.priceAmount ?? offer.price?.amount);
  return Number.isFinite(amount) && amount > 0;
}

function hasAnyPriceSignal(offer = {}) {
  return hasUsablePrice(offer) || textPresent(offer.priceCurrent?.originalText) || textPresent(offer.price?.originalText);
}

function hasInvalidPrice(offer = {}) {
  const values = [offer.priceCurrent?.amount, offer.priceAmount, offer.price?.amount]
    .filter((value) => value !== null && value !== undefined && value !== '');
  return values.some((value) => !Number.isFinite(Number(value)) || Number(value) <= 0);
}

function collectValidityLabels(offer = {}) {
  const rawFacts = offer.rawFacts || {};
  return uniqueCompact([
    offer.validityLabel,
    rawFacts.validityLabel,
    rawFacts.validityText,
    rawFacts.validity,
    rawFacts.sourceMetadata?.validity,
    rawFacts.sourceMetadata?.validityText,
  ]);
}

function detectValiditySignal(offer = {}, now = new Date()) {
  const validFrom = dateKey(offer.validFrom);
  const validTo = dateKey(offer.validTo);
  const labels = collectValidityLabels(offer);
  const today = new Date(now);
  const toDate = offer.validTo ? new Date(offer.validTo) : null;
  const fromDate = offer.validFrom ? new Date(offer.validFrom) : null;
  const safelyExpired = toDate && !Number.isNaN(toDate.getTime()) && toDate < today;
  const safelyActive = Boolean(
    offer.isActiveNow
    || offer.isActiveToday
    || (
      fromDate && toDate
      && !Number.isNaN(fromDate.getTime())
      && !Number.isNaN(toDate.getTime())
      && fromDate <= today
      && today <= toDate
    )
  );

  return {
    validFromPresent: Boolean(validFrom),
    validToPresent: Boolean(validTo),
    bothValidFromToPresent: Boolean(validFrom && validTo),
    validityLabelPresent: labels.length > 0,
    noValiditySignal: !validFrom && !validTo && labels.length === 0,
    expiredApprox: Boolean(safelyExpired),
    activeNowApprox: Boolean(safelyActive),
    uncertainValidity: !safelyExpired && !safelyActive && (!validFrom || !validTo),
  };
}

function detectQuantitySignal(offer = {}) {
  const normalizedAmount = Number(offer.normalizedUnitPrice?.amount);
  return {
    quantityTextPresent: textPresent(offer.quantityText),
    unitPresent: textPresent(offer.unitType) || textPresent(offer.comparableUnit) || textPresent(offer.normalizedUnitPrice?.unit),
    normalizedUnitPricePresent: Number.isFinite(normalizedAmount) && normalizedAmount > 0,
    packageSizePresent: Number.isFinite(Number(offer.packCount)) || Number.isFinite(Number(offer.unitValue)) || Number.isFinite(Number(offer.totalComparableAmount)),
  };
}

function hasQuantitySignal(offer = {}) {
  const signal = detectQuantitySignal(offer);
  return signal.quantityTextPresent || signal.unitPresent || signal.normalizedUnitPricePresent || signal.packageSizePresent;
}

function detectConditionSignal(offer = {}) {
  const minimumQty = Number(offer.minimumPurchaseQty);
  const text = String(offer.conditionsText || offer.rawFacts?.conditionsText || '').trim();
  const multiBuyText = /\b(?:1\+1|2\s*(?:fuer|für|fur)\s*1|4\s*(?:fuer|für|fur)\s*2|gratis|ab\s+\d+\s+st|mehrkauf|multibuy)\b/i.test(text);
  const customerText = /\b(?:j[öo]|\bapp\b|kundenkarte|konto|club|karte)\b/i.test(text);
  return {
    conditionsTextPresent: text.length > 0,
    customerProgramRequired: Boolean(offer.customerProgramRequired || customerText),
    minimumPurchaseQtyPresent: Number.isFinite(minimumQty) && minimumQty > 1,
    multiBuyCondition: Boolean(offer.isMultiBuy || offer.benefitType === 'multi-buy' || offer.effectiveDiscountType === 'multi-buy' || multiBuyText),
  };
}

function hasConditionSignal(offer = {}) {
  const signal = detectConditionSignal(offer);
  return signal.conditionsTextPresent || signal.customerProgramRequired || signal.minimumPurchaseQtyPresent || signal.multiBuyCondition || offer.hasConditions === true;
}

function isTitleTooShortOrGeneric(title = '') {
  const normalized = String(title || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (normalized.length < 4) return true;
  return /^(aktion|angebot|angebote|produkt|artikel|diverse|verschiedene|sortiment)$/.test(normalized);
}

function detectProductClarity(offer = {}) {
  return {
    titlePresent: textPresent(offer.title),
    titleTooShortOrGeneric: !textPresent(offer.title) || isTitleTooShortOrGeneric(offer.title),
    categoryPresent: textPresent(offer.categoryKey) || textPresent(offer.categoryPrimary),
    comparisonGroupPresent: textPresent(offer.comparisonGroup),
    imagePresent: textPresent(offer.imageUrl),
  };
}

function calculateCompletenessScore(offer = {}) {
  const checks = [
    textPresent(offer.title),
    textPresent(offer.retailerKey) || textPresent(offer.retailerName),
    hasUsablePrice(offer),
    detectValiditySignal(offer).validToPresent || detectValiditySignal(offer).validityLabelPresent,
    hasQuantitySignal(offer),
    hasConditionSignal(offer) || offer.hasConditions === false || !textPresent(offer.conditionsText),
    textPresent(offer.categoryKey) || textPresent(offer.categoryPrimary),
  ];

  return {
    diagnosticOnly: true,
    score: Number((checks.filter(Boolean).length / checks.length).toFixed(3)),
    passedChecks: checks.filter(Boolean).length,
    totalChecks: checks.length,
  };
}

function emptyCoverage() {
  return {
    totalOffers: 0,
    activeOffersApprox: 0,
    officialOfferCount: 0,
    aggregatorOfferCount: 0,
    validity: {
      validFromPresentCount: 0,
      validToPresentCount: 0,
      bothValidFromToPresentCount: 0,
      validityLabelPresentCount: 0,
      noValiditySignalCount: 0,
      expiredApproxCount: 0,
      activeNowApproxCount: 0,
      uncertainValidityCount: 0,
    },
    price: {
      priceCurrentAmountPresentCount: 0,
      priceAmountPresentCount: 0,
      noUsablePriceCount: 0,
      zeroOrInvalidPriceCount: 0,
    },
    quantity: {
      quantityTextPresentCount: 0,
      unitPresentCount: 0,
      normalizedUnitPricePresentCount: 0,
      packageSizePresentCount: 0,
      noQuantitySignalCount: 0,
    },
    conditions: {
      conditionsTextPresentCount: 0,
      customerProgramRequiredCount: 0,
      minimumPurchaseQtyPresentCount: 0,
      multiBuyConditionCount: 0,
      noConditionSignalCount: 0,
    },
    productClarity: {
      titlePresentCount: 0,
      titleTooShortOrGenericCount: 0,
      categoryPresentCount: 0,
      comparisonGroupPresentCount: 0,
      imagePresentCount: 0,
    },
    completenessScoreAvg: 0,
  };
}

function sourceTypeIsOfficial(sourceType = '') {
  return /official/i.test(String(sourceType || ''));
}

function sourceTypeIsAggregator(sourceType = '', sourceUrl = '') {
  return /aktionsfinder|aggregator|wogibtswas|marktguru/i.test(`${sourceType || ''} ${sourceUrl || ''}`);
}

function sourceKeyForOffer(offer = {}) {
  return offer.sourceType || offer.rawFacts?.sourceKey || offer.sourceUrl || 'unknown';
}

function summarizeOffer(offer = {}) {
  return {
    id: String(offer._id || ''),
    title: offer.title || '',
    retailerKey: offer.retailerKey || '',
    retailerName: offer.retailerName || '',
    sourceKey: sourceKeyForOffer(offer),
    sourceType: offer.sourceType || '',
    sourceUrl: offer.sourceUrl || '',
    priceCurrentAmount: offer.priceCurrent?.amount ?? null,
    priceText: offer.priceCurrent?.originalText || '',
    quantityText: offer.quantityText || '',
    unit: offer.unitType || offer.comparableUnit || offer.normalizedUnitPrice?.unit || '',
    normalizedUnitPriceAmount: offer.normalizedUnitPrice?.amount ?? null,
    normalizedUnitPriceUnit: offer.normalizedUnitPrice?.unit || '',
    validFrom: dateKey(offer.validFrom),
    validTo: dateKey(offer.validTo),
    validityLabel: collectValidityLabels(offer)[0] || '',
    categoryKey: offer.categoryKey || '',
    categoryPrimary: offer.categoryPrimary || '',
    comparisonGroup: offer.comparisonGroup || '',
    conditionsText: offer.conditionsText || '',
    customerProgramRequired: Boolean(offer.customerProgramRequired),
    minimumPurchaseQty: offer.minimumPurchaseQty ?? null,
    isMultiBuy: Boolean(offer.isMultiBuy),
  };
}

function addOfferToCoverage(coverage, offer = {}, now = new Date()) {
  coverage.totalOffers += 1;
  if (offer.isActiveNow || offer.isActiveToday) coverage.activeOffersApprox += 1;
  if (sourceTypeIsOfficial(offer.sourceType)) coverage.officialOfferCount += 1;
  if (sourceTypeIsAggregator(offer.sourceType, offer.sourceUrl)) coverage.aggregatorOfferCount += 1;

  const validity = detectValiditySignal(offer, now);
  if (validity.validFromPresent) coverage.validity.validFromPresentCount += 1;
  if (validity.validToPresent) coverage.validity.validToPresentCount += 1;
  if (validity.bothValidFromToPresent) coverage.validity.bothValidFromToPresentCount += 1;
  if (validity.validityLabelPresent) coverage.validity.validityLabelPresentCount += 1;
  if (validity.noValiditySignal) coverage.validity.noValiditySignalCount += 1;
  if (validity.expiredApprox) coverage.validity.expiredApproxCount += 1;
  if (validity.activeNowApprox) coverage.validity.activeNowApproxCount += 1;
  if (validity.uncertainValidity) coverage.validity.uncertainValidityCount += 1;

  if (Number.isFinite(Number(offer.priceCurrent?.amount)) && Number(offer.priceCurrent.amount) > 0) coverage.price.priceCurrentAmountPresentCount += 1;
  if (hasAnyPriceSignal(offer)) coverage.price.priceAmountPresentCount += 1;
  if (!hasUsablePrice(offer)) coverage.price.noUsablePriceCount += 1;
  if (hasInvalidPrice(offer)) coverage.price.zeroOrInvalidPriceCount += 1;

  const quantity = detectQuantitySignal(offer);
  if (quantity.quantityTextPresent) coverage.quantity.quantityTextPresentCount += 1;
  if (quantity.unitPresent) coverage.quantity.unitPresentCount += 1;
  if (quantity.normalizedUnitPricePresent) coverage.quantity.normalizedUnitPricePresentCount += 1;
  if (quantity.packageSizePresent) coverage.quantity.packageSizePresentCount += 1;
  if (!hasQuantitySignal(offer)) coverage.quantity.noQuantitySignalCount += 1;

  const conditions = detectConditionSignal(offer);
  if (conditions.conditionsTextPresent) coverage.conditions.conditionsTextPresentCount += 1;
  if (conditions.customerProgramRequired) coverage.conditions.customerProgramRequiredCount += 1;
  if (conditions.minimumPurchaseQtyPresent) coverage.conditions.minimumPurchaseQtyPresentCount += 1;
  if (conditions.multiBuyCondition) coverage.conditions.multiBuyConditionCount += 1;
  if (!hasConditionSignal(offer)) coverage.conditions.noConditionSignalCount += 1;

  const clarity = detectProductClarity(offer);
  if (clarity.titlePresent) coverage.productClarity.titlePresentCount += 1;
  if (clarity.titleTooShortOrGeneric) coverage.productClarity.titleTooShortOrGenericCount += 1;
  if (clarity.categoryPresent) coverage.productClarity.categoryPresentCount += 1;
  if (clarity.comparisonGroupPresent) coverage.productClarity.comparisonGroupPresentCount += 1;
  if (clarity.imagePresent) coverage.productClarity.imagePresentCount += 1;

  coverage.completenessScoreAvg += calculateCompletenessScore(offer).score;
}

function finalizeCoverage(coverage) {
  const total = coverage.totalOffers;
  const finalized = {
    ...coverage,
    ratios: {
      validToPresent: ratio(coverage.validity.validToPresentCount, total),
      usablePrice: ratio(total - coverage.price.noUsablePriceCount, total),
      quantitySignal: ratio(total - coverage.quantity.noQuantitySignalCount, total),
      conditionSignal: ratio(total - coverage.conditions.noConditionSignalCount, total),
      categoryPresent: ratio(coverage.productClarity.categoryPresentCount, total),
    },
    completenessScoreAvg: total ? Number((coverage.completenessScoreAvg / total).toFixed(3)) : 0,
  };
  return finalized;
}

function buildCoverageFromOffers(offers = [], now = new Date()) {
  const coverage = emptyCoverage();
  for (const offer of offers) addOfferToCoverage(coverage, offer, now);
  return finalizeCoverage(coverage);
}

function classifyRisks(coverage = emptyCoverage(), { retailerKey = '', hasAggregator = false, sourceKey = '' } = {}) {
  const risks = [];
  const total = coverage.totalOffers || 0;
  const validToPct = pct(coverage.validity?.validToPresentCount, total);
  const noValidityPct = pct(coverage.validity?.noValiditySignalCount, total);
  const usablePricePct = pct(total - (coverage.price?.noUsablePriceCount || 0), total);
  const quantityPct = pct(total - (coverage.quantity?.noQuantitySignalCount || 0), total);
  const conditionTextCount = coverage.conditions?.conditionsTextPresentCount || 0;
  const conditionFlagCount = (coverage.conditions?.customerProgramRequiredCount || 0)
    + (coverage.conditions?.minimumPurchaseQtyPresentCount || 0)
    + (coverage.conditions?.multiBuyConditionCount || 0);

  if (noValidityPct >= 50) risks.push('missing-validity');
  else if (validToPct < 70) risks.push('weak-validity');
  if (usablePricePct < 70) risks.push('missing-price');
  if (quantityPct < 60) risks.push('missing-quantity');
  if (conditionFlagCount > conditionTextCount) risks.push('condition-unclear');
  if (['billa', 'billa-plus'].includes(retailerKey)) risks.push('retailer-scope-risk');
  if (hasAggregator && sourceTypeIsOfficial(sourceKey) && (usablePricePct < 90 || validToPct < 90 || quantityPct < 80)) {
    risks.push('official-weaker-than-aggregator');
  }
  if (validToPct < 80 || usablePricePct < 80 || quantityPct < 70) risks.push('parser-field-loss');
  if (risks.length === 0 && total === 0) risks.push('unclear');

  return uniqueCompact(risks);
}

function recommendActions(risks = []) {
  if (risks.length === 0) return ['keine Änderung nötig'];

  const actions = [];
  if (risks.includes('missing-validity') || risks.includes('weak-validity')) actions.push('parser-validity-fix prüfen');
  if (risks.includes('condition-unclear')) actions.push('parser-condition-fix prüfen');
  if (risks.includes('missing-quantity')) actions.push('quantity-normalization prüfen');
  if (risks.includes('official-weaker-than-aggregator')) {
    actions.push('source-priority-schutz beibehalten');
    actions.push('official-vs-aggregator dedupe auditieren');
  }
  if (risks.includes('retailer-scope-risk')) actions.push('retailer-scope prüfen');
  if (actions.length === 0) actions.push('source-priority-schutz beibehalten');

  return uniqueCompact(actions);
}

function buildExamples({ officialOffers = [], aggregatorOffers = [] } = {}) {
  const official = officialOffers.map((offer) => ({ offer, score: calculateCompletenessScore(offer).score }));
  const aggregatorsByRetailer = new Map();
  for (const offer of aggregatorOffers) {
    const key = `${offer.retailerKey || ''}::${String(offer.titleNormalized || offer.title || '').slice(0, 24).toLowerCase()}`;
    if (!aggregatorsByRetailer.has(key)) aggregatorsByRetailer.set(key, []);
    aggregatorsByRetailer.get(key).push(offer);
  }

  const examplesOfficialCouldNotSafelyReplaceAggregator = [];
  for (const { offer, score } of official) {
    if (examplesOfficialCouldNotSafelyReplaceAggregator.length >= EXAMPLE_LIMIT) break;
    const key = `${offer.retailerKey || ''}::${String(offer.titleNormalized || offer.title || '').slice(0, 24).toLowerCase()}`;
    const candidates = aggregatorsByRetailer.get(key) || [];
    const stronger = candidates.find((candidate) => calculateCompletenessScore(candidate).score > score && hasUsablePrice(candidate));
    if (stronger) {
      examplesOfficialCouldNotSafelyReplaceAggregator.push({
        official: summarizeOffer(offer),
        aggregatorCandidate: summarizeOffer(stronger),
        reason: 'aggregator-candidate-has-higher-diagnostic-completeness',
      });
    }
  }

  return {
    examplesGood: official
      .filter(({ offer }) => hasUsablePrice(offer) && !detectValiditySignal(offer).noValiditySignal && hasQuantitySignal(offer) && detectProductClarity(offer).categoryPresent)
      .sort((left, right) => right.score - left.score)
      .slice(0, EXAMPLE_LIMIT)
      .map(({ offer }) => summarizeOffer(offer)),
    examplesWeakValidity: officialOffers
      .filter((offer) => detectValiditySignal(offer).noValiditySignal)
      .slice(0, EXAMPLE_LIMIT)
      .map(summarizeOffer),
    examplesNoPrice: officialOffers
      .filter((offer) => !hasUsablePrice(offer))
      .slice(0, EXAMPLE_LIMIT)
      .map(summarizeOffer),
    examplesNoQuantity: officialOffers
      .filter((offer) => !hasQuantitySignal(offer))
      .slice(0, EXAMPLE_LIMIT)
      .map(summarizeOffer),
    examplesConditionRisk: officialOffers
      .filter((offer) => hasConditionSignal(offer))
      .slice(0, EXAMPLE_LIMIT)
      .map(summarizeOffer),
    examplesOfficialCouldNotSafelyReplaceAggregator,
  };
}

function activeOfficialSourcesForRetailer(retailerKey) {
  return RETAILER_DEFINITIONS
    .filter((source) => source.retailerKey === retailerKey)
    .filter((source) => source.enabled !== false && source.latestStatus !== 'inactive')
    .filter((source) => /official/i.test(`${source.channel || ''} ${source.sourceType || ''} ${source.sourceUrl || ''}`))
    .map((source) => ({
      sourceKey: source.sourceType || `${retailerKey}-${source.channel || 'official'}`,
      sourceType: source.sourceType || source.channel || '',
      channel: source.channel || '',
      label: source.label || '',
      sourceUrl: source.sourceUrl || '',
    }));
}

function groupBySource(offers = []) {
  const groups = new Map();
  for (const offer of offers) {
    if (!sourceTypeIsOfficial(offer.sourceType)) continue;
    const key = sourceKeyForOffer(offer);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(offer);
  }
  return groups;
}

function countBreakdown(offers = [], keyFn, limit = 20) {
  const counts = new Map();
  for (const offer of offers) {
    const key = keyFn(offer) || 'unknown';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

function buildRetailerReport({ retailer, offers = [], now = new Date() } = {}) {
  const officialOffers = offers.filter((offer) => sourceTypeIsOfficial(offer.sourceType));
  const aggregatorOffers = offers.filter((offer) => sourceTypeIsAggregator(offer.sourceType, offer.sourceUrl));
  const coverage = buildCoverageFromOffers(offers, now);
  const sourceGroups = groupBySource(officialOffers);
  const hasAggregator = aggregatorOffers.length > 0;

  coverage.sourceBreakdown = countBreakdown(offers, (offer) => sourceKeyForOffer(offer));
  coverage.categoryBreakdown = countBreakdown(offers, (offer) => offer.categoryKey || offer.categoryPrimary);

  const sourceBreakdown = [...sourceGroups.entries()]
    .sort((left, right) => right[1].length - left[1].length)
    .map(([sourceKey, groupOffers]) => {
      const sourceCoverage = buildCoverageFromOffers(groupOffers, now);
      const risks = classifyRisks(sourceCoverage, { retailerKey: retailer.retailerKey, hasAggregator, sourceKey });
      const examples = buildExamples({ officialOffers: groupOffers, aggregatorOffers });
      return {
        sourceKey,
        sourceType: groupOffers[0]?.sourceType || '',
        offerCount: groupOffers.length,
        coverage: sourceCoverage,
        risks,
        recommendedNextActions: recommendActions(risks),
        ...examples,
      };
    });

  const retailerRisks = uniqueCompact(sourceBreakdown.flatMap((source) => source.risks));

  return {
    retailerKey: retailer.retailerKey,
    displayName: retailer.displayName,
    activeOfficialSources: activeOfficialSourcesForRetailer(retailer.retailerKey),
    coverage,
    sourceBreakdown,
    risks: retailerRisks,
    recommendedNextAction: recommendActions(retailerRisks)[0] || 'keine Änderung nötig',
  };
}

function buildSummary(retailers = []) {
  const sourceRows = retailers.flatMap((retailer) =>
    retailer.sourceBreakdown.map((source) => ({
      retailerKey: retailer.retailerKey,
      sourceKey: source.sourceKey,
      offerCount: source.offerCount,
      completenessScoreAvg: source.coverage.completenessScoreAvg,
      risks: source.risks,
      recommendedNextActions: source.recommendedNextActions,
    }))
  );

  const withOffers = sourceRows.filter((row) => row.offerCount > 0);
  const topRisks = uniqueCompact(sourceRows.flatMap((row) => row.risks)).map((risk) => ({
    risk,
    sourceCount: sourceRows.filter((row) => row.risks.includes(risk)).length,
  })).sort((left, right) => right.sourceCount - left.sourceCount);

  return {
    checkedRetailers: retailers.map((retailer) => retailer.retailerKey),
    checkedSourceKeys: sourceRows.map((row) => `${row.retailerKey}:${row.sourceKey}`),
    topRisks,
    bestCoveredOfficialSources: [...withOffers]
      .sort((left, right) => right.completenessScoreAvg - left.completenessScoreAvg || right.offerCount - left.offerCount)
      .slice(0, 5),
    weakestOfficialSources: [...withOffers]
      .sort((left, right) => left.completenessScoreAvg - right.completenessScoreAvg || right.offerCount - left.offerCount)
      .slice(0, 5),
    recommendedNextActions: uniqueCompact(sourceRows.flatMap((row) => row.recommendedNextActions)),
  };
}

async function fetchOffersForRetailers({ Offer, retailerKeys, limit = DEFAULT_LIMIT } = {}) {
  if (!Offer) return [];
  const boundedLimit = Math.max(50, Math.min(Number(limit || DEFAULT_LIMIT) * 100, 2000));
  const projection = [
    'retailerKey retailerName title titleNormalized brand sourceType sourceUrl sourceId',
    'priceCurrent quantityText packCount unitValue unitType totalComparableAmount comparableUnit normalizedUnitPrice',
    'validFrom validTo isActiveNow isActiveToday status rawFacts',
    'conditionsText customerProgramRequired hasConditions isMultiBuy minimumPurchaseQty benefitType effectiveDiscountType',
    'categoryKey categoryPrimary subcategoryKey comparisonGroup imageUrl quality',
  ].join(' ');

  const rows = await Promise.all(retailerKeys.map((retailerKey) =>
    Offer.find({ retailerKey })
      .sort({ isActiveNow: -1, isActiveToday: -1, updatedAt: -1 })
      .limit(boundedLimit)
      .select(projection)
      .maxTimeMS(QUERY_MAX_TIME_MS)
      .lean()
  ));

  return rows.flat();
}

async function buildOfficialValidityCoverageDiagnostic({
  Offer,
  generatedAt = new Date(),
  now = new Date(),
  limit = DEFAULT_LIMIT,
} = {}) {
  const retailerKeys = CHECKED_RETAILERS.map((retailer) => retailer.retailerKey);
  const offers = await fetchOffersForRetailers({ Offer, retailerKeys, limit });
  const offersByRetailer = new Map();
  for (const offer of offers) {
    if (!offersByRetailer.has(offer.retailerKey)) offersByRetailer.set(offer.retailerKey, []);
    offersByRetailer.get(offer.retailerKey).push(offer);
  }

  const retailers = CHECKED_RETAILERS.map((retailer) => buildRetailerReport({
    retailer,
    offers: offersByRetailer.get(retailer.retailerKey) || [],
    now,
  }));

  return {
    ok: true,
    readOnly: true,
    mutatedCollections: [],
    generatedAt: generatedAt instanceof Date ? generatedAt.toISOString() : generatedAt,
    principle: 'Qualitaet der Daten ist kein Nebenthema - sie IST das Produkt.',
    diagnosticOnly: true,
    summary: buildSummary(retailers),
    retailers,
    inactiveOfficialContext: INACTIVE_OFFICIAL_CONTEXT,
  };
}

module.exports = {
  CHECKED_RETAILERS,
  DEFAULT_LIMIT,
  INACTIVE_OFFICIAL_CONTEXT,
  buildCoverageFromOffers,
  buildOfficialValidityCoverageDiagnostic,
  buildRetailerReport,
  calculateCompletenessScore,
  classifyRisks,
  collectValidityLabels,
  detectConditionSignal,
  detectProductClarity,
  detectQuantitySignal,
  detectValiditySignal,
  hasConditionSignal,
  hasQuantitySignal,
  hasUsablePrice,
  pct,
  ratio,
  recommendActions,
  sourceTypeIsAggregator,
  sourceTypeIsOfficial,
};
