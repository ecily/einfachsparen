const { RETAILER_DEFINITIONS } = require('../sources/sourceDefinitions');
const {
  buildSourceEvidenceEntries,
  inferExtractionMethod,
} = require('./sourceLadderAudit');

const TARGET_RETAILERS = [
  { retailerKey: 'billa', retailerName: 'BILLA' },
  { retailerKey: 'billa-plus', retailerName: 'BILLA PLUS' },
  { retailerKey: 'lidl', retailerName: 'LIDL' },
  { retailerKey: 'penny', retailerName: 'PENNY' },
  { retailerKey: 'spar', retailerName: 'SPAR / INTERSPAR / EUROSPAR' },
  { retailerKey: 'hofer', retailerName: 'HOFER' },
  { retailerKey: 'dm', retailerName: 'dm' },
  { retailerKey: 'bipa', retailerName: 'BIPA' },
  { retailerKey: 'pagro', retailerName: 'PAGRO' },
  { retailerKey: 'adeg', retailerName: 'ADEG' },
];

const SOURCE_CONFIDENCE_BY_METHOD = {
  'structured-json': 94,
  'official-html': 86,
  'aggregator-json': 78,
  'viewer-metadata': 58,
  'pdf-textlayer': 52,
  'ocr-bbox': 28,
  unknown: 20,
};

const NOISE_TITLE_PATTERNS = [
  /^angebot$/i,
  /^aktion$/i,
  /^flugblatt$/i,
  /^prospekt$/i,
  /^produkt$/i,
  /^unknown$/i,
  /^unbekannt$/i,
  /^seite\s+\d+$/i,
  /^bild\s+\d+$/i,
  /^ocr\b/i,
];

function pct(part, total) {
  return total > 0 ? Number(((part / total) * 100).toFixed(1)) : 0;
}

function avg(values = []) {
  const numbers = values.map(Number).filter((value) => Number.isFinite(value));
  return numbers.length > 0 ? Number((numbers.reduce((sum, value) => sum + value, 0) / numbers.length).toFixed(1)) : 0;
}

function unique(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function hasValue(value) {
  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value);
  }

  if (typeof value === 'boolean') {
    return true;
  }

  return Boolean(String(value || '').trim());
}

function hasUsableDate(value) {
  if (!value) {
    return false;
  }

  const date = value instanceof Date ? value : new Date(value);
  return !Number.isNaN(date.getTime());
}

function dateKey(value) {
  if (!hasUsableDate(value)) {
    return '';
  }

  return new Date(value).toISOString().slice(0, 10);
}

function isActiveNowUsable(offer = {}, now = new Date()) {
  if (typeof offer.isActiveNow === 'boolean') {
    return true;
  }

  if (offer.status === 'active' && (!hasUsableDate(offer.validTo) || new Date(offer.validTo) >= now)) {
    return true;
  }

  return hasUsableDate(offer.validFrom) && hasUsableDate(offer.validTo);
}

function isOfficialChannel(channel = '') {
  return channel === 'official-site' || channel === 'official-flyer';
}

function isOfficialSourceType(sourceType = '') {
  return /official|algolia|api/.test(String(sourceType || '').toLowerCase());
}

function isFallbackTitle(title = '') {
  const clean = String(title || '').replace(/\s+/g, ' ').trim();

  if (!clean || clean.length < 4) {
    return true;
  }

  return NOISE_TITLE_PATTERNS.some((pattern) => pattern.test(clean));
}

function normalizeTitle(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function coverageMetric(label, count, total, samples = []) {
  return {
    label,
    present: count,
    total,
    pct: pct(count, total),
    samples: samples.slice(0, 8),
  };
}

function computeDuplicateTitleCount(offers = []) {
  const counts = new Map();

  for (const offer of offers) {
    const titleKey = normalizeTitle(offer.titleNormalized || offer.title);
    const retailerKey = normalizeTitle(offer.retailerKey || offer.retailerName);
    const priceKey = offer.priceCurrent?.amount ? String(offer.priceCurrent.amount) : '';
    const quantityKey = normalizeTitle(offer.quantityText || `${offer.unitValue || ''}${offer.unitType || ''}`);
    const validityKey = `${dateKey(offer.validFrom)}:${dateKey(offer.validTo)}`;
    const key = [retailerKey, titleKey, priceKey, quantityKey, validityKey].join('::');

    if (!titleKey) {
      continue;
    }

    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return [...counts.values()].filter((count) => count > 1).reduce((sum, count) => sum + count - 1, 0);
}

function buildDefinitionProfile(definitions = []) {
  const enabled = definitions.filter((source) => source.enabled !== false);
  const disabled = definitions.filter((source) => source.enabled === false);
  const officialEnabled = enabled.filter((source) => isOfficialChannel(source.channel));
  const primary = [...enabled].sort((left, right) => {
    const leftOfficial = Number(isOfficialChannel(left.channel));
    const rightOfficial = Number(isOfficialChannel(right.channel));

    if (rightOfficial !== leftOfficial) {
      return rightOfficial - leftOfficial;
    }

    return Number(left.priority ?? 50) - Number(right.priority ?? 50);
  })[0] || null;

  return {
    definitions: definitions.length,
    enabled: enabled.length,
    disabled: disabled.length,
    disabledSources: disabled.map((source) => ({
      label: source.label || '',
      channel: source.channel || '',
      disabledReason: source.disabledReason || '',
    })),
    officialSourceConfigured: officialEnabled.length > 0,
    primarySourceFromMatrix: primary ? {
      label: primary.label || '',
      channel: primary.channel || '',
      sourceType: primary.sourceType || '',
      enabled: primary.enabled !== false,
    } : null,
  };
}

function buildSourceProfile({ retailerKey, offers = [], sources = [], definitions = [] } = {}) {
  const sourceTypes = unique(offers.flatMap((offer) => [
    offer.sourceType,
    ...(Array.isArray(offer.sourceTypes) ? offer.sourceTypes : []),
  ])).sort();
  const dbSources = sources.filter((source) => source.retailerKey === retailerKey);
  const activeDefinitions = definitions.filter((source) => source.retailerKey === retailerKey);
  const matrix = buildDefinitionProfile(activeDefinitions);
  const entries = buildSourceEvidenceEntries({
    definitions: activeDefinitions,
    sources: dbSources,
    offerRows: sourceTypes.map((sourceType) => ({
      retailerKey,
      sourceType,
      offers: offers.filter((offer) => offer.sourceType === sourceType).length,
      activeNow: offers.filter((offer) => offer.sourceType === sourceType && offer.isActiveNow === true).length,
      avgSourceConfidence: avg(offers.filter((offer) => offer.sourceType === sourceType).map((offer) => offer.sourceConfidence)),
    })),
  });
  const enabledEntries = entries.filter((entry) => entry.enabled !== false);
  const officialSourceObserved = enabledEntries.some((entry) =>
    isOfficialChannel(entry.channel) || isOfficialSourceType(entry.sourceType)
  ) || offers.some((offer) => isOfficialSourceType(offer.sourceType));
  const confidenceValues = offers
    .map((offer) => Number(offer.sourceConfidence || 0) * 100)
    .filter((value) => value > 0);
  const inferredConfidenceValues = enabledEntries.map((entry) =>
    (entry.sourceConfidence || 0) <= 1 ? Number(entry.sourceConfidence || 0) * 100 : Number(entry.sourceConfidence || 0)
  );
  const sourceConfidence = confidenceValues.length > 0
    ? avg(confidenceValues)
    : avg(inferredConfidenceValues);
  const methods = unique(enabledEntries.map((entry) => entry.extractionMethod || inferExtractionMethod(entry))).sort();

  return {
    sourceTypes,
    primarySourceFromMatrix: matrix.primarySourceFromMatrix,
    sourceConfidence,
    officialSourceConfigured: matrix.officialSourceConfigured,
    officialSourceObserved,
    enabledSourceCount: matrix.enabled,
    disabledSourceCount: matrix.disabled,
    disabledSources: matrix.disabledSources,
    extractionMethods: methods,
  };
}

function buildFiveQuestionCoverage(offers = [], sourceProfile = {}, now = new Date()) {
  const total = offers.length;
  const titleNoiseSamples = [];
  const unclearQuantitySamples = [];
  const unclearConditionSamples = [];

  let titlePresent = 0;
  let titleNormalizedPresent = 0;
  let categoryPresent = 0;
  let comparisonPresent = 0;
  let pricePresent = 0;
  let retailerPresent = 0;
  let validFromPresent = 0;
  let validToPresent = 0;
  let validityLabelPresent = 0;
  let activeNowUsable = 0;
  let explicitlyExpired = 0;
  let quantityTextPresent = 0;
  let unitPresent = 0;
  let normalizedUnitPricePresent = 0;
  let comparisonSafe = 0;
  let hasConditionsPresent = 0;
  let customerProgramPresent = 0;
  let isMultiBuyPresent = 0;
  let minimumPurchaseQtyPresent = 0;
  let conditionsTextPresent = 0;

  for (const offer of offers) {
    const title = offer.title || '';

    if (hasValue(title)) titlePresent += 1;
    if (hasValue(offer.titleNormalized)) titleNormalizedPresent += 1;
    if (hasValue(offer.categoryKey) || hasValue(offer.categoryPrimary) || hasValue(offer.subcategoryKey)) categoryPresent += 1;
    if (hasValue(offer.comparisonGroup) || hasValue(offer.dedupeKey) || hasValue(offer.comparisonSignature)) comparisonPresent += 1;
    if (hasValue(offer.priceCurrent?.amount)) pricePresent += 1;
    if (hasValue(offer.retailerKey) && hasValue(offer.retailerName)) retailerPresent += 1;
    if (hasUsableDate(offer.validFrom)) validFromPresent += 1;
    if (hasUsableDate(offer.validTo)) validToPresent += 1;
    if (hasValue(offer.validityLabel) || hasValue(offer.rawFacts?.validityLabel) || hasValue(offer.rawFacts?.validityText)) validityLabelPresent += 1;
    if (isActiveNowUsable(offer, now)) activeNowUsable += 1;
    if (offer.status === 'expired' || (hasUsableDate(offer.validTo) && new Date(offer.validTo) < now)) explicitlyExpired += 1;
    if (hasValue(offer.quantityText)) quantityTextPresent += 1;
    if (hasValue(offer.unitValue) && hasValue(offer.unitType)) unitPresent += 1;
    if (hasValue(offer.normalizedUnitPrice?.amount) && hasValue(offer.normalizedUnitPrice?.unit)) normalizedUnitPricePresent += 1;
    if (offer.quality?.comparisonSafe === true || offer.normalizedUnitPrice?.comparable === true) comparisonSafe += 1;
    if (typeof offer.hasConditions === 'boolean') hasConditionsPresent += 1;
    if (typeof offer.customerProgramRequired === 'boolean') customerProgramPresent += 1;
    if (typeof offer.isMultiBuy === 'boolean') isMultiBuyPresent += 1;
    if (hasValue(offer.minimumPurchaseQty)) minimumPurchaseQtyPresent += 1;
    if (hasValue(offer.conditionsText)) conditionsTextPresent += 1;

    if (isFallbackTitle(title)) {
      titleNoiseSamples.push(title || offer.titleNormalized || String(offer._id || 'unknown'));
    }

    if (!hasValue(offer.quantityText) && !(hasValue(offer.unitValue) && hasValue(offer.unitType))) {
      unclearQuantitySamples.push(title || String(offer._id || 'unknown'));
    }

    if ((offer.hasConditions || offer.customerProgramRequired || offer.isMultiBuy || Number(offer.minimumPurchaseQty || 1) > 1) && !hasValue(offer.conditionsText)) {
      unclearConditionSamples.push(title || String(offer._id || 'unknown'));
    }
  }

  const whatMetrics = [
    coverageMetric('titlePresent', titlePresent, total, titleNoiseSamples),
    coverageMetric('titleNormalizedPresent', titleNormalizedPresent, total),
    coverageMetric('categoryOrSubcategoryPresent', categoryPresent, total),
    coverageMetric('comparisonGroupOrDedupeKeyPresent', comparisonPresent, total),
    coverageMetric('priceCurrentPresent', pricePresent, total),
  ];
  const whereMetrics = [
    coverageMetric('retailerKeyAndNamePresent', retailerPresent, total),
    coverageMetric('officialSourceObserved', sourceProfile.officialSourceObserved ? total : 0, total),
    coverageMetric('sourceConfidenceAtLeast70', sourceProfile.sourceConfidence >= 70 ? total : 0, total),
  ];
  const whenMetrics = [
    coverageMetric('validFromPresent', validFromPresent, total),
    coverageMetric('validToPresent', validToPresent, total),
    coverageMetric('validityLabelPresent', validityLabelPresent, total),
    coverageMetric('isActiveNowPresentOrUsable', activeNowUsable, total),
  ];
  const quantityMetrics = [
    coverageMetric('quantityTextPresent', quantityTextPresent, total, unclearQuantitySamples),
    coverageMetric('unitValueAndUnitTypePresent', unitPresent, total),
    coverageMetric('normalizedUnitPricePresent', normalizedUnitPricePresent, total),
    coverageMetric('comparisonSafe', comparisonSafe, total),
  ];
  const conditionMetrics = [
    coverageMetric('hasConditionsPresent', hasConditionsPresent, total),
    coverageMetric('customerProgramRequiredPresent', customerProgramPresent, total),
    coverageMetric('isMultiBuyPresent', isMultiBuyPresent, total),
    coverageMetric('minimumPurchaseQtyPresent', minimumPurchaseQtyPresent, total),
    coverageMetric('conditionsTextPresent', conditionsTextPresent, total, unclearConditionSamples),
  ];

  return {
    whatIsIt: {
      score: avg(whatMetrics.map((metric) => metric.pct)),
      titlePresentPct: pct(titlePresent, total),
      titleNormalizedPresentPct: pct(titleNormalizedPresent, total),
      categorySubcategoryPresentPct: pct(categoryPresent, total),
      comparisonGroupDedupeKeyPresentPct: pct(comparisonPresent, total),
      priceCurrentPresentPct: pct(pricePresent, total),
      noiseFallbackTitleCount: titleNoiseSamples.length,
      noiseFallbackTitleSamples: unique(titleNoiseSamples).slice(0, 8),
    },
    whereIsIt: {
      score: avg(whereMetrics.map((metric) => metric.pct)),
      retailerKeyNamePresentPct: pct(retailerPresent, total),
      sourceTypes: sourceProfile.sourceTypes,
      primarySourceFromMatrix: sourceProfile.primarySourceFromMatrix,
      sourceConfidence: sourceProfile.sourceConfidence,
      officialSourceAvailable: sourceProfile.officialSourceObserved,
      officialSourceConfigured: sourceProfile.officialSourceConfigured,
    },
    whenIsIt: {
      score: avg(whenMetrics.map((metric) => metric.pct)),
      validFromPresentPct: pct(validFromPresent, total),
      validToPresentPct: pct(validToPresent, total),
      validityLabelPresentPct: pct(validityLabelPresent, total),
      isActiveNowPresentUsablePct: pct(activeNowUsable, total),
      explicitlyExpiredCount: explicitlyExpired,
      explicitlyExpiredPct: pct(explicitlyExpired, total),
      offersWithoutEndDate: Math.max(0, total - validToPresent),
    },
    quantityUnit: {
      score: avg(quantityMetrics.map((metric) => metric.pct)),
      quantityTextPresentPct: pct(quantityTextPresent, total),
      unitValueUnitTypePresentPct: pct(unitPresent, total),
      normalizedUnitPricePresentPct: pct(normalizedUnitPricePresent, total),
      comparisonSafePct: pct(comparisonSafe, total),
      unclearQuantityUnitCount: unclearQuantitySamples.length,
      unclearQuantityUnitSamples: unique(unclearQuantitySamples).slice(0, 8),
    },
    conditions: {
      score: avg(conditionMetrics.map((metric) => metric.pct)),
      hasConditionsPresentPct: pct(hasConditionsPresent, total),
      customerProgramRequiredPresentPct: pct(customerProgramPresent, total),
      isMultiBuyPresentPct: pct(isMultiBuyPresent, total),
      minimumPurchaseQtyPresentPct: pct(minimumPurchaseQtyPresent, total),
      conditionsTextPresentPct: pct(conditionsTextPresent, total),
      unclearConditionCount: unclearConditionSamples.length,
      unclearConditionSamples: unique(unclearConditionSamples).slice(0, 8),
    },
  };
}

function sourcePathIsUsableForMvp(sourceProfile = {}) {
  const methods = sourceProfile.extractionMethods || [];
  return Boolean(
    sourceProfile.officialSourceObserved
    || sourceProfile.sourceConfidence >= 70
    || methods.some((method) => ['structured-json', 'official-html', 'aggregator-json'].includes(method))
  );
}

function riskFromThresholds(value, { highBelow, mediumBelow }) {
  if (value < highBelow) {
    return 'high';
  }

  if (value < mediumBelow) {
    return 'medium';
  }

  return 'low';
}

function buildPlanningRisks({ offers = [], coverage = {}, sourceProfile = {}, duplicateTitleCount = 0 } = {}) {
  const sourceMixRisk = sourceProfile.sourceTypes.length > 1
    ? 'medium'
    : 'low';
  const missingValidityRisk = coverage.whenIsIt.validToPresentPct < 80 || coverage.whenIsIt.validFromPresentPct < 70
    ? 'high'
    : coverage.whenIsIt.validToPresentPct < 95
      ? 'medium'
      : 'low';
  const variantMergeRisk = duplicateTitleCount > Math.max(2, offers.length * 0.05) || coverage.whatIsIt.comparisonGroupDedupeKeyPresentPct < 80
    ? 'high'
    : duplicateTitleCount > 0 || coverage.whatIsIt.comparisonGroupDedupeKeyPresentPct < 95
      ? 'medium'
      : 'low';
  const userTrustRisk = [
    missingValidityRisk,
    variantMergeRisk,
    sourceProfile.officialSourceObserved ? 'low' : 'high',
    coverage.quantityUnit.comparisonSafePct < 50 ? 'high' : coverage.quantityUnit.comparisonSafePct < 75 ? 'medium' : 'low',
  ].includes('high')
    ? 'high'
    : [
      missingValidityRisk,
      variantMergeRisk,
      coverage.quantityUnit.comparisonSafePct < 75 ? 'medium' : 'low',
    ].includes('medium')
      ? 'medium'
      : 'low';

  return {
    duplicateTitleCount,
    sourceMixRisk,
    missingValidityRisk,
    variantMergeRisk,
    userTrustRisk,
  };
}

function buildMvpRisks({ offers = [], coverage = {}, sourceProfile = {}, duplicateTitleCount = 0 } = {}) {
  const total = offers.length;
  const duplicateShare = total > 0 ? (duplicateTitleCount / total) * 100 : 0;
  const noiseShare = coverage.whatIsIt.noiseFallbackTitleCount > 0 && total > 0
    ? (coverage.whatIsIt.noiseFallbackTitleCount / total) * 100
    : 0;
  const sourceReliabilityRisk = sourceProfile.enabledSourceCount === 0 || !sourcePathIsUsableForMvp(sourceProfile)
    ? 'high'
    : sourceProfile.sourceConfidence < 70
      ? 'medium'
      : 'low';
  const productClarityRisk = [
    riskFromThresholds(coverage.whatIsIt.titlePresentPct, { highBelow: 80, mediumBelow: 95 }),
    riskFromThresholds(coverage.whatIsIt.priceCurrentPresentPct, { highBelow: 70, mediumBelow: 90 }),
    riskFromThresholds(coverage.whereIsIt.retailerKeyNamePresentPct, { highBelow: 90, mediumBelow: 99 }),
  ].includes('high')
    ? 'high'
    : [
      riskFromThresholds(coverage.whatIsIt.titlePresentPct, { highBelow: 80, mediumBelow: 95 }),
      riskFromThresholds(coverage.whatIsIt.priceCurrentPresentPct, { highBelow: 70, mediumBelow: 90 }),
      riskFromThresholds(coverage.whereIsIt.retailerKeyNamePresentPct, { highBelow: 90, mediumBelow: 99 }),
    ].includes('medium')
      ? 'medium'
      : 'low';
  const quantityRisk = coverage.quantityUnit.quantityTextPresentPct >= 85 || coverage.quantityUnit.normalizedUnitPricePresentPct >= 80
    ? 'low'
    : coverage.quantityUnit.quantityTextPresentPct >= 60 || coverage.quantityUnit.normalizedUnitPricePresentPct >= 60
      ? 'medium'
      : 'high';
  const duplicateNoiseRisk = duplicateShare > 10 || noiseShare > 10 || coverage.whatIsIt.comparisonGroupDedupeKeyPresentPct < 70
    ? 'high'
    : duplicateShare > 3 || noiseShare > 3 || coverage.whatIsIt.comparisonGroupDedupeKeyPresentPct < 90
      ? 'medium'
      : 'low';
  const expiredOfferRisk = coverage.whenIsIt.explicitlyExpiredPct > 5
    ? 'high'
    : coverage.whenIsIt.explicitlyExpiredPct > 0
      ? 'medium'
      : 'low';
  const missingValidityRisk = coverage.whenIsIt.validToPresentPct < 50
    ? 'medium'
    : coverage.whenIsIt.validToPresentPct < 80
      ? 'low'
      : 'low';
  const userTrustRisk = [
    sourceReliabilityRisk,
    productClarityRisk,
    quantityRisk,
    duplicateNoiseRisk,
    expiredOfferRisk,
  ].includes('high')
    ? 'high'
    : [
      sourceReliabilityRisk,
      productClarityRisk,
      quantityRisk,
      duplicateNoiseRisk,
      expiredOfferRisk,
    ].includes('medium')
      ? 'medium'
      : 'low';

  return {
    duplicateTitleCount,
    sourceReliabilityRisk,
    productClarityRisk,
    quantityRisk,
    duplicateNoiseRisk,
    expiredOfferRisk,
    missingValidityRisk,
    userTrustRisk,
  };
}

function determinePlanningStatus({ offerCount = 0, score = 0, coverage = {}, risks = {}, sourceProfile = {} } = {}) {
  if (offerCount === 0 || !sourceProfile.officialSourceConfigured || sourceProfile.enabledSourceCount === 0) {
    return 'not-ready';
  }

  if (
    score >= 88
    && coverage.whenIsIt.validToPresentPct >= 95
    && coverage.quantityUnit.comparisonSafePct >= 75
    && risks.userTrustRisk === 'low'
  ) {
    return 'ready';
  }

  if (
    score >= 74
    && coverage.whenIsIt.validToPresentPct >= 80
    && risks.userTrustRisk !== 'high'
  ) {
    return 'usable-with-caution';
  }

  if (score >= 45 || offerCount > 0 || sourceProfile.enabledSourceCount > 0) {
    return 'watch';
  }

  return 'not-ready';
}

function scoreMvpSearch(coverage = {}) {
  return avg([
    coverage.whatIsIt.titlePresentPct,
    coverage.whatIsIt.priceCurrentPresentPct,
    coverage.whereIsIt.retailerKeyNamePresentPct,
    coverage.whereIsIt.sourceConfidence,
    coverage.quantityUnit.quantityTextPresentPct,
    coverage.quantityUnit.normalizedUnitPricePresentPct,
    coverage.whatIsIt.comparisonGroupDedupeKeyPresentPct,
    coverage.whenIsIt.isActiveNowPresentUsablePct,
  ]);
}

function determineMvpSearchStatus({ offerCount = 0, score = 0, coverage = {}, risks = {}, sourceProfile = {} } = {}) {
  if (offerCount === 0 || sourceProfile.enabledSourceCount === 0 || !sourcePathIsUsableForMvp(sourceProfile)) {
    return 'not-ready';
  }

  if (coverage.whenIsIt.explicitlyExpiredPct > 5 || risks.userTrustRisk === 'high') {
    return score >= 55 ? 'watch' : 'not-ready';
  }

  if (
    offerCount >= 50
    && score >= 88
    && coverage.whatIsIt.titlePresentPct >= 98
    && coverage.whatIsIt.priceCurrentPresentPct >= 95
    && coverage.quantityUnit.normalizedUnitPricePresentPct >= 80
    && risks.userTrustRisk === 'low'
  ) {
    return 'ready';
  }

  if (
    offerCount >= 20
    && score >= 72
    && coverage.whatIsIt.titlePresentPct >= 95
    && coverage.whatIsIt.priceCurrentPresentPct >= 85
    && risks.userTrustRisk !== 'high'
  ) {
    return 'usable-with-caution';
  }

  if (score >= 45 || offerCount > 0) {
    return 'watch';
  }

  return 'not-ready';
}

function recommendPlanningNextAction({ status, coverage = {}, risks = {}, sourceProfile = {}, offerCount = 0 } = {}) {
  if (offerCount === 0) {
    return 'Keine aktive Angebotsbasis sichtbar: Quelle aktivieren oder Crawl-Ergebnis pruefen, bevor der Haendler produktiv angezeigt wird.';
  }

  if (!sourceProfile.officialSourceObserved) {
    return 'Offizielle Quelle als Evidence/Primaerpfad sichtbar machen oder Aggregator-Coverage gegen offizielle Quelle absichern.';
  }

  if (coverage.whenIsIt.validToPresentPct < 90) {
    return 'Gueltigkeitsfenster stabilisieren: validFrom/validTo aus sicheren Rohsignalen vor Launch vervollstaendigen.';
  }

  if (coverage.quantityUnit.comparisonSafePct < 70) {
    return 'Mengen- und Einheitennormalisierung verbessern, damit Preisvergleiche nur sicher und nachvollziehbar erscheinen.';
  }

  if (risks.variantMergeRisk !== 'low') {
    return 'Dedupe-/Vergleichsschluessel nachschaerfen, damit Varianten und Dubletten nicht Nutzervertrauen kosten.';
  }

  if (status === 'ready') {
    return 'Launch-faehig halten: taegliche Readiness-Diagnose als Regressionstor vor Public Launch laufen lassen.';
  }

  return 'Feldvollstaendigkeit und Source-Prioritaet weiter stabilisieren, dann Haendler erneut gegen ready-Schwellen pruefen.';
}

function recommendMvpNextAction({ status, coverage = {}, risks = {}, sourceProfile = {}, offerCount = 0 } = {}) {
  if (offerCount === 0) {
    return 'Keine aktive Angebotsbasis sichtbar: fuer MVP nicht anzeigen, bis regelmaessige aktive Offers vorhanden sind.';
  }

  if (!sourcePathIsUsableForMvp(sourceProfile)) {
    return 'Source-Pfad fuer MVP klaeren: offizielle/strukturierte Quelle oder bewaehrten Aggregator mit stabiler Coverage nachweisen.';
  }

  if (coverage.whatIsIt.priceCurrentPresentPct < 90) {
    return 'Preisabdeckung messen und problematische Offers aus der MVP-Suche herausfiltern oder nachnormalisieren.';
  }

  if (coverage.quantityUnit.quantityTextPresentPct < 80 && coverage.quantityUnit.normalizedUnitPricePresentPct < 80) {
    return 'Mengen-/Einheitensignale verbessern oder UI-Fallback fuer Angebote ohne Vergleichseinheit bewusst begrenzen.';
  }

  if (coverage.whenIsIt.explicitlyExpiredPct > 0) {
    return 'Explizit abgelaufene Offers aus der aktiven Suchdiagnose entfernen und Source-Aktualitaet pruefen.';
  }

  if (risks.duplicateNoiseRisk !== 'low') {
    return 'Dubletten- und Noise-Signale reduzieren, damit Nutzer in der Suche keine mehrfachen oder generischen Treffer sehen.';
  }

  if (status === 'ready') {
    return 'MVP-sichtbar halten und taeglich mit Readiness-Diagnose gegen Source-, Preis- und Noise-Regressionen pruefen.';
  }

  return 'MVP-Suche mit ehrlicher Marktpruefungs-Hinweislogik betreiben und Source-/Preis-/Mengenabdeckung weiter haerten.';
}

function scorePlanning(coverage = {}) {
  return avg([
    coverage.whatIsIt.score,
    coverage.whereIsIt.score,
    coverage.whenIsIt.score,
    coverage.quantityUnit.score,
    coverage.conditions.score,
  ]);
}

function buildRetailerReadiness({ retailer, offers = [], sources = [], definitions = RETAILER_DEFINITIONS, generatedAt = new Date() } = {}) {
  const sourceProfile = buildSourceProfile({
    retailerKey: retailer.retailerKey,
    offers,
    sources,
    definitions,
  });
  const fiveQuestionCoverage = buildFiveQuestionCoverage(offers, sourceProfile, generatedAt);
  const duplicateTitleCount = computeDuplicateTitleCount(offers);
  const planningRisks = buildPlanningRisks({
    offers,
    coverage: fiveQuestionCoverage,
    sourceProfile,
    duplicateTitleCount,
  });
  const mvpRisks = buildMvpRisks({
    offers,
    coverage: fiveQuestionCoverage,
    sourceProfile,
    duplicateTitleCount,
  });
  const planningScore = scorePlanning(fiveQuestionCoverage);
  const mvpSearchScore = scoreMvpSearch(fiveQuestionCoverage);
  const planningStatus = determinePlanningStatus({
    offerCount: offers.length,
    score: planningScore,
    coverage: fiveQuestionCoverage,
    risks: planningRisks,
    sourceProfile,
  });
  const mvpSearchStatus = determineMvpSearchStatus({
    offerCount: offers.length,
    score: mvpSearchScore,
    coverage: fiveQuestionCoverage,
    risks: mvpRisks,
    sourceProfile,
  });

  return {
    retailerKey: retailer.retailerKey,
    retailerName: retailer.retailerName,
    launchStatus: planningStatus,
    mvpSearchStatus,
    planningStatus,
    score: planningScore,
    mvpSearchScore,
    planningScore,
    offerCount: offers.length,
    fiveQuestionCoverage,
    sourceProfile,
    risks: planningRisks,
    mvpRisks,
    planningRisks,
    nextAction: recommendPlanningNextAction({
      status: planningStatus,
      coverage: fiveQuestionCoverage,
      risks: planningRisks,
      sourceProfile,
      offerCount: offers.length,
    }),
    recommendedMvpNextAction: recommendMvpNextAction({
      status: mvpSearchStatus,
      coverage: fiveQuestionCoverage,
      risks: mvpRisks,
      sourceProfile,
      offerCount: offers.length,
    }),
    recommendedPlanningNextAction: recommendPlanningNextAction({
      status: planningStatus,
      coverage: fiveQuestionCoverage,
      risks: planningRisks,
      sourceProfile,
      offerCount: offers.length,
    }),
  };
}

function buildTopRisks(retailers = [], riskField = 'planningRisks') {
  const counts = new Map();

  for (const retailer of retailers) {
    for (const [key, value] of Object.entries(retailer[riskField] || retailer.risks || {})) {
      if (key === 'duplicateTitleCount') {
        continue;
      }

      if (value === 'high') {
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([risk, retailerCount]) => ({ risk, retailerCount }))
    .slice(0, 5);
}

function buildRecommendedPlanningNext3Actions(retailers = []) {
  const actions = [];

  if (retailers.some((retailer) => retailer.fiveQuestionCoverage.whenIsIt.validToPresentPct < 90)) {
    actions.push('Gueltigkeitsfenster pro Haendler als Launch-Gate definieren: validFrom/validTo muessen fuer aktive Offers belastbar sein.');
  }

  if (retailers.some((retailer) => retailer.fiveQuestionCoverage.quantityUnit.comparisonSafePct < 70)) {
    actions.push('Mengen-/Einheitennormalisierung vor Preisvergleich schaerfen und unsichere Vergleiche konsequent ausblenden.');
  }

  if (retailers.some((retailer) => retailer.risks.variantMergeRisk !== 'low' || retailer.risks.sourceMixRisk !== 'low')) {
    actions.push('Source-Prioritaet, Dedupe-Key und Variantenlogik als gemeinsame Haendler-Readiness-Regel absichern.');
  }

  if (retailers.some((retailer) => !retailer.sourceProfile.officialSourceObserved)) {
    actions.push('Offizielle Quellen pro Markt sichtbar als Evidence fuehren; disabled Quellen nicht produktiv werten.');
  }

  actions.push('Readiness-Diagnose taeglich und vor jedem Public-/Store-Release laufen lassen.');

  return unique(actions).slice(0, 3);
}

function buildRecommendedMvpNext3Actions(retailers = []) {
  const actions = [];

  if (retailers.some((retailer) => retailer.fiveQuestionCoverage.whatIsIt.priceCurrentPresentPct < 95)) {
    actions.push('Preisabdeckung als MVP-Gate messen: Angebote ohne klaren aktuellen Preis nicht prominent in der Suche verwenden.');
  }

  if (retailers.some((retailer) => retailer.mvpRisks.sourceReliabilityRisk !== 'low')) {
    actions.push('Pro Haendler einen belastbaren Source-Pfad definieren: offizielle/strukturierte Quelle oder bewaehrter Aggregator mit regelmaessiger Aktualisierung.');
  }

  if (retailers.some((retailer) => retailer.mvpRisks.duplicateNoiseRisk !== 'low')) {
    actions.push('Dubletten-, Fallback-Titel- und Noise-Anteile als Suchqualitaets-Gate ueberwachen.');
  }

  if (retailers.some((retailer) => retailer.fiveQuestionCoverage.quantityUnit.normalizedUnitPricePresentPct < 80)) {
    actions.push('Mengen-/Einheiten-Fallback fuer MVP bewusst begrenzen und sichere Vergleichseinheiten weiter erhoehen.');
  }

  if (retailers.some((retailer) => retailer.fiveQuestionCoverage.whenIsIt.explicitlyExpiredPct > 0)) {
    actions.push('Explizit abgelaufene Offers aus der aktiven Suche ausschliessen und Source-Aktualitaet pruefen.');
  }

  actions.push('Readiness-Diagnose taeglich vor Public-/Store-Release laufen lassen und MVP/Planning getrennt bewerten.');

  return unique(actions).slice(0, 3);
}

function groupByRetailer(items = []) {
  const grouped = new Map();

  for (const item of items) {
    const key = String(item.retailerKey || '').trim();

    if (!key) {
      continue;
    }

    if (!grouped.has(key)) {
      grouped.set(key, []);
    }

    grouped.get(key).push(item);
  }

  return grouped;
}

function buildRetailerReadinessDiagnostic({
  offers = [],
  sources = [],
  definitions = RETAILER_DEFINITIONS,
  targetRetailers = TARGET_RETAILERS,
  generatedAt = new Date(),
} = {}) {
  const offersByRetailer = groupByRetailer(offers);
  const retailers = targetRetailers.map((retailer) => buildRetailerReadiness({
    retailer,
    offers: offersByRetailer.get(retailer.retailerKey) || [],
    sources,
    definitions,
    generatedAt,
  }));
  const mvpSearch = {
    ready: retailers.filter((retailer) => retailer.mvpSearchStatus === 'ready').length,
    usableWithCaution: retailers.filter((retailer) => retailer.mvpSearchStatus === 'usable-with-caution').length,
    watch: retailers.filter((retailer) => retailer.mvpSearchStatus === 'watch').length,
    notReady: retailers.filter((retailer) => retailer.mvpSearchStatus === 'not-ready').length,
  };
  const planning = {
    ready: retailers.filter((retailer) => retailer.planningStatus === 'ready').length,
    usableWithCaution: retailers.filter((retailer) => retailer.planningStatus === 'usable-with-caution').length,
    watch: retailers.filter((retailer) => retailer.planningStatus === 'watch').length,
    notReady: retailers.filter((retailer) => retailer.planningStatus === 'not-ready').length,
  };

  return {
    ok: true,
    readOnly: true,
    mutatedCollections: [],
    generatedAt: generatedAt instanceof Date ? generatedAt.toISOString() : generatedAt,
    summary: {
      retailersAnalyzed: retailers.length,
      mvpSearch,
      planning,
      ready: planning.ready,
      usableWithCaution: planning.usableWithCaution,
      watch: planning.watch,
      notReady: planning.notReady,
      topRisks: buildTopRisks(retailers, 'planningRisks'),
      mvpTopRisks: buildTopRisks(retailers, 'mvpRisks'),
      planningTopRisks: buildTopRisks(retailers, 'planningRisks'),
      recommendedNext3Actions: buildRecommendedPlanningNext3Actions(retailers),
      recommendedMvpNextActions: buildRecommendedMvpNext3Actions(retailers),
      recommendedPlanningNextActions: buildRecommendedPlanningNext3Actions(retailers),
    },
    retailers,
  };
}

module.exports = {
  TARGET_RETAILERS,
  SOURCE_CONFIDENCE_BY_METHOD,
  buildRetailerReadinessDiagnostic,
  buildRetailerReadiness,
  buildFiveQuestionCoverage,
  determineLaunchStatus: determinePlanningStatus,
  determinePlanningStatus,
  determineMvpSearchStatus,
  computeDuplicateTitleCount,
};
