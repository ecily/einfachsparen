const { buildSourceEvidence, sanitizeWhitespace, normalizeTitleForMatch } = require('./sourceEvidence');
const {
  determineOfferSubcategory,
  determineCategoryDecision,
  buildInclusiveScopeDecision,
} = require('./categoryClassifier');
const { extractPromotionRequirement } = require('../offers/promotionMath');
const { applyManualCategoryOverridesToOfferSync } = require('../quality/manualCategoryOverrideService');

function parseNumericAmount(value) {
  if (value === null || value === undefined || value === '$undefined') {
    return null;
  }

  const numeric = Number(String(value).replace(',', '.'));
  return Number.isFinite(numeric) ? numeric : null;
}

function toAsciiLower(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\u00e4/g, 'ae')
    .replace(/\u00f6/g, 'oe')
    .replace(/\u00fc/g, 'ue')
    .replace(/\u00df/g, 'ss');
}

function buildKey(value, fallback = '') {
  const normalized = normalizeTitleForMatch(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function roundNumber(value, precision = 3) {
  if (!Number.isFinite(value)) {
    return null;
  }

  return Number(value.toFixed(precision));
}

function normalizeUnitSymbol(unit) {
  if (!unit) {
    return '';
  }

  const normalized = toAsciiLower(unit);

  if (normalized.includes('kilogramm') || normalized === 'kg') {
    return 'kg';
  }

  if (normalized.includes('gramm') || normalized === 'g') {
    return 'g';
  }

  if (normalized.includes('milliliter') || normalized === 'ml') {
    return 'ml';
  }

  if (normalized.includes('zentiliter') || normalized === 'cl') {
    return 'cl';
  }

  if (normalized.includes('liter') || normalized === 'l') {
    return 'l';
  }

  if (normalized.includes('stueck') || normalized.includes('stk')) {
    return 'Stk';
  }

  return sanitizeWhitespace(unit);
}

function buildQuantityText(product) {
  const parts = [];

  if (product?.productQuantity && product?.productQuantityUnit?.shortName) {
    parts.push(`${product.productQuantity} ${product.productQuantityUnit.shortName}`);
  }

  if (product?.packageQuantity && product?.packageQuantityUnit?.shortName) {
    parts.push(`${product.packageQuantity} ${product.packageQuantityUnit.shortName}`);
  }

  return parts.join(' / ');
}

function buildValidityText(validFrom, validTo) {
  const parts = [];

  if (validFrom) {
    parts.push(`ab ${new Date(validFrom).toISOString().slice(0, 10)}`);
  }

  if (validTo) {
    parts.push(`bis ${new Date(validTo).toISOString().slice(0, 10)}`);
  }

  return parts.join(' ');
}

function detectPackageType(product = {}, quantityText = '') {
  const packageUnitType = product?.packageQuantityUnit?.type;
  const packageUnitName = toAsciiLower(
    product?.packageQuantityUnit?.shortName || product?.packageQuantityUnit?.name || quantityText
  );

  if (packageUnitType === 'PACKAGING') {
    return 'pack';
  }

  if (/(flasche|dose|glas|beutel|pack|packung|rolle|kapsel)/.test(packageUnitName)) {
    return 'pack';
  }

  if (/(stk|stueck)/.test(packageUnitName)) {
    return 'piece';
  }

  return '';
}

function normalizeComparableQuantity(quantity, unit) {
  if (!quantity || !unit) {
    return { quantity: null, unit: '', comparable: false };
  }

  if (unit === 'g') {
    return { quantity: quantity / 1000, unit: 'kg', comparable: true };
  }

  if (unit === 'ml') {
    return { quantity: quantity / 1000, unit: 'l', comparable: true };
  }

  if (unit === 'cl') {
    return { quantity: quantity / 100, unit: 'l', comparable: true };
  }

  return {
    quantity,
    unit,
    comparable: ['kg', 'l', 'Stk'].includes(unit),
  };
}

function buildComparableBase(product) {
  const productQuantity = parseNumericAmount(product?.productQuantity);
  const productUnit = normalizeUnitSymbol(product?.productQuantityUnit?.shortName || product?.productQuantityUnit?.name);
  const packageQuantity = parseNumericAmount(product?.packageQuantity);
  const packageUnit = normalizeUnitSymbol(product?.packageQuantityUnit?.shortName || product?.packageQuantityUnit?.name);
  const isPackagingMultiplier = product?.packageQuantityUnit?.type === 'PACKAGING';

  if (productQuantity && productUnit) {
    const normalized = normalizeComparableQuantity(productQuantity, productUnit);
    const multiplier = packageQuantity && isPackagingMultiplier ? packageQuantity : 1;

    return {
      quantity: normalized.quantity ? roundNumber(normalized.quantity * multiplier) : null,
      unit: normalized.unit,
      comparable: normalized.comparable && multiplier > 0,
    };
  }

  if (packageQuantity && packageUnit === 'Stk') {
    return {
      quantity: packageQuantity,
      unit: 'Stk',
      comparable: true,
    };
  }

  return {
    quantity: null,
    unit: '',
    comparable: false,
  };
}

function buildStructuredQuantityFields(product, quantityText, comparableBase) {
  const unitValue = parseNumericAmount(product?.productQuantity);
  const unitType = normalizeUnitSymbol(product?.productQuantityUnit?.shortName || product?.productQuantityUnit?.name);
  const packageQuantity = parseNumericAmount(product?.packageQuantity);
  const packageType = detectPackageType(product, quantityText);
  let packCount = null;

  if (packageQuantity && packageType === 'pack') {
    packCount = packageQuantity;
  } else if (packageQuantity && normalizeUnitSymbol(product?.packageQuantityUnit?.shortName || product?.packageQuantityUnit?.name) === 'Stk') {
    packCount = packageQuantity;
  }

  return {
    packCount,
    unitValue,
    unitType,
    totalComparableAmount: comparableBase?.quantity || null,
    comparableUnit: comparableBase?.unit || '',
    packageType,
  };
}

function buildComparisonQuantityKey(comparableBase) {
  if (!comparableBase?.quantity || !comparableBase?.unit) {
    return '';
  }

  return `${String(comparableBase.quantity).replace('.', '_')}-${comparableBase.unit}`;
}

function buildComparisonAmountKey(comparableBase) {
  if (!comparableBase?.quantity || !comparableBase?.unit) {
    return '';
  }

  return `${roundNumber(comparableBase.quantity, 3)}-${comparableBase.unit}`;
}

function deriveBenefitType(promotion) {
  const title = toAsciiLower(`${promotion.title || ''} ${promotion.description || ''}`);

  if (promotion.discountPercentage || /%|statt/.test(title)) {
    return 'price-cut';
  }

  if (/\b\d+\+\d+\b|\bgratis\b/.test(title)) {
    return 'multi-buy';
  }

  return 'unknown';
}

function detectCustomerProgramRequired(promotion) {
  const haystack = toAsciiLower(
    `${promotion.title || ''} ${promotion.description || ''} ${(promotion.tags || []).join(' ')}`
  );

  return /(joe|karte|kundenkarte|app|konto|club)/.test(haystack);
}

function buildConditionsText(promotion) {
  const parts = [];
  const discountPercentage = parseNumericAmount(promotion.discountPercentage);
  const minimalAcceptance = parseNumericAmount(promotion.minimalAcceptance);

  if (discountPercentage !== null) {
    parts.push(`${discountPercentage}% Rabatt laut Quelle`);
  }

  if (minimalAcceptance && minimalAcceptance > 1) {
    parts.push(`ab ${minimalAcceptance} Stk.`);
  }

  return parts.join(' / ');
}

function buildComparisonSignature({ title = '', brand = '' }) {
  const stopwords = new Set([
    'adeg',
    'bipa',
    'billa',
    'hofer',
    'lidl',
    'dm',
    'pagro',
    'penny',
    'spar',
    'plus',
    'diskont',
    'aktion',
    'sorten',
    'versch',
    'oder',
    'und',
    'packung',
    'flasche',
    'dose',
    'glas',
    'beutel',
    'becher',
    'stuk',
    'stueck',
    'liter',
    'gramm',
    'kg',
    'ml',
    'cl',
  ]);

  const haystack = toAsciiLower(`${brand} ${title}`)
    .replace(/\b\d+[.,]?\d*\b/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ');

  const tokens = haystack
    .split(/\s+/)
    .filter((token) => token.length > 2 && !stopwords.has(token))
    .slice(0, 8);

  return tokens.join('-');
}

function buildTitleNormalized({ title = '', brand = '' }) {
  return normalizeTitleForMatch(`${brand} ${title}`).replace(/\s+/g, ' ').trim();
}

function buildCategoryKey({ categoryPrimary = '', categorySecondary = '' }) {
  return buildKey(categorySecondary || categoryPrimary, 'unkategorisiert');
}

function buildComparisonGroup({ comparisonSignature = '', comparableBase = {}, normalizedUnitPrice = {} }) {
  const unitPriceAmount = Number(normalizedUnitPrice?.amount);

  if (!comparisonSignature || !normalizedUnitPrice?.comparable || !(unitPriceAmount > 0)) {
    return '';
  }

  if (!comparableBase?.quantity || !comparableBase?.unit) {
    return '';
  }

  return `${comparisonSignature}::${buildComparisonAmountKey(comparableBase)}`;
}

function determineEffectiveDiscountType({ benefitType, customerProgramRequired, minimalAcceptance, requirement }) {
  if (requirement?.mechanic === 'x-plus-y' || requirement?.mechanic === 'x-for-y' || benefitType === 'multi-buy') {
    return 'multi-buy';
  }

  if ((minimalAcceptance || 0) > 1 || requirement?.mechanic === 'threshold') {
    return 'threshold';
  }

  if (benefitType === 'price-cut') {
    return 'price-cut';
  }

  if (customerProgramRequired) {
    return 'card-required';
  }

  return 'unknown';
}

function buildOfferStatus(validFrom, validTo, snapshotCurrent = false) {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const hasStarted = validFrom ? validFrom <= now : false;
  const hasNotEnded = validTo ? validTo >= now : false;
  const overlapsToday =
    (!validFrom || validFrom <= endOfToday) &&
    (!validTo || validTo >= startOfToday);

  let status = 'unknown';

  if (snapshotCurrent) {
    status = 'active';
  } else if (validFrom && validFrom > now) {
    status = 'upcoming';
  } else if (validTo && validTo < now) {
    status = 'expired';
  } else if ((validFrom || validTo) && (hasStarted || !validFrom) && (hasNotEnded || !validTo)) {
    status = 'active';
  }

  return {
    status,
    isActiveNow: status === 'active',
    isActiveToday: overlapsToday,
  };
}

function buildSearchText({
  retailerName = '',
  brand = '',
  title = '',
  titleNormalized = '',
  categoryPrimary = '',
  categorySecondary = '',
  categoryKey = '',
  quantityText = '',
  conditionsText = '',
}) {
  return normalizeTitleForMatch(
    [
      retailerName,
      brand,
      title,
      titleNormalized,
      categoryPrimary,
      categorySecondary,
      categoryKey,
      quantityText,
      conditionsText,
    ]
      .filter(Boolean)
      .join(' ')
  );
}

function buildSortScoreDefault({
  isActiveNow,
  customerProgramRequired,
  hasConditions,
  isMultiBuy,
  quality,
  normalizedUnitPrice,
}) {
  let score = 0;

  if (isActiveNow) score += 100;
  if (quality?.comparisonSafe) score += 50;
  if (!customerProgramRequired) score += 20;
  if (!hasConditions) score += 10;
  if (!isMultiBuy) score += 10;
  score += Math.round((quality?.parsingConfidence || 0) * 10);

  const unitAmount = Number(normalizedUnitPrice?.amount);
  if (Number.isFinite(unitAmount) && unitAmount > 0) {
    score += Math.max(0, 20 - Math.min(20, Math.round(unitAmount)));
  }

  return score;
}

function buildNormalizedUnitPrice(promotion) {
  const product = promotion.product || {};
  const amount = parseNumericAmount(promotion.discountedPrice ?? promotion.newPrice);
  const comparableBase = buildComparableBase(product);

  if (!amount || !comparableBase.quantity || !comparableBase.unit || comparableBase.quantity <= 0) {
    return {
      amount: null,
      unit: '',
      comparable: false,
      confidence: 0,
    };
  }

  return {
    amount: Number((amount / comparableBase.quantity).toFixed(2)),
    unit: comparableBase.unit,
    comparable: comparableBase.comparable,
    confidence: comparableBase.comparable ? 0.9 : 0.4,
  };
}

function buildCompactRawFacts({ promotion, requirement, validityText, conditionsText }) {
  const tags = Array.isArray(promotion?.tags) ? promotion.tags.slice(0, 5).map((tag) => sanitizeWhitespace(tag)) : [];
  const infoParts = [promotion?.description, conditionsText].map((value) => sanitizeWhitespace(value)).filter(Boolean);
  const compact = {
    sourceType: 'aktionsfinder-json',
    validityText,
    infoText: infoParts.join(' / '),
    discountPercentage: parseNumericAmount(promotion?.discountPercentage),
    minimalAcceptance: parseNumericAmount(promotion?.minimalAcceptance),
    minimumPurchaseQuantity: requirement?.requiredQuantity || 1,
    requiredQuantity: requirement?.requiredQuantity || 1,
    tags,
  };

  if (compact.discountPercentage === null) {
    delete compact.discountPercentage;
  }

  if (compact.minimalAcceptance === null) {
    delete compact.minimalAcceptance;
  }

  if (!compact.infoText) {
    delete compact.infoText;
  }

  if (!compact.validityText) {
    delete compact.validityText;
  }

  if (compact.minimumPurchaseQuantity <= 1) {
    delete compact.minimumPurchaseQuantity;
  }

  if (compact.requiredQuantity <= 1) {
    delete compact.requiredQuantity;
  }

  if (compact.tags.length === 0) {
    delete compact.tags;
  }

  return compact;
}

function normalizePromotionToOffer({ promotion, retailerKey, retailerName, sourceId, crawlJobId, region, sourceUrl }) {
  const product = promotion.product || {};
  const productGroups = promotion.productGroups || product.productGroups || [];
  const priceCurrentAmount = parseNumericAmount(promotion.discountedPrice ?? promotion.newPrice);
  const comparableBase = buildComparableBase(product);
  const priceReferenceAmount = parseNumericAmount(promotion.originalPrice ?? promotion.oldPrice);
  const normalizedUnitPrice = buildNormalizedUnitPrice(promotion);
  const categoryDecision = determineCategoryDecision({
    title: promotion.title,
    contextText: promotion.description || '',
    sourceCategory: productGroups[0]?.title || '',
    productGroups,
  });
  const categoryPrimary = categoryDecision.primaryCategory;
  const scopeDecision = buildInclusiveScopeDecision();
  const quantityText = buildQuantityText(product);
  const conditionsText = buildConditionsText(promotion);
  const customerProgramRequired = detectCustomerProgramRequired(promotion);
  const title = sanitizeWhitespace(promotion.fullDisplayName || promotion.title);
  const titleNormalized = buildTitleNormalized({
    title,
    brand: product.brand?.name || '',
  });
  const issues = [];
  const comparisonCategory = categoryDecision.secondaryCategory || determineOfferSubcategory({
    primaryCategory: categoryPrimary,
    sourceCategory: productGroups[0]?.title || '',
    fallbackLabel: categoryPrimary,
    title: promotion.title,
    contextText: promotion.description || '',
    productGroups,
  });
  const brand = sanitizeWhitespace(product.brand?.name || '');
  const categoryKey = buildCategoryKey({
    categoryPrimary,
    categorySecondary: comparisonCategory,
  });
  const comparisonQuantityKey = buildComparisonQuantityKey(comparableBase);
  const comparisonSignature = buildComparisonSignature({
    title,
    brand,
  });
  let comparisonGroup = buildComparisonGroup({
    comparisonSignature,
    comparableBase,
    normalizedUnitPrice,
  });
  const requirement = extractPromotionRequirement({
    title,
    conditionsText,
    rawFacts: {
      minimalAcceptance: parseNumericAmount(promotion.minimalAcceptance),
      discountPercentage: parseNumericAmount(promotion.discountPercentage),
      requiredQuantity: null,
      minimumPurchaseQuantity: null,
      tags: Array.isArray(promotion.tags) ? promotion.tags : [],
      loyaltyTags: [],
    },
    benefitType: deriveBenefitType(promotion),
  });
  const structuredQuantityFields = buildStructuredQuantityFields(product, quantityText, comparableBase);
  const validityText = buildValidityText(promotion.validFrom, promotion.validTo);
  const safeClickoutUrl =
    typeof promotion.clickoutUrl === 'string' && promotion.clickoutUrl && promotion.clickoutUrl !== '$undefined'
      ? promotion.clickoutUrl
      : sourceUrl;

  if (!title || !priceCurrentAmount) {
    return null;
  }

  if (!promotion.validFrom || !promotion.validTo) {
    issues.push('Gueltigkeitszeitraum unvollstaendig');
  }

  if (!normalizedUnitPrice.comparable) {
    issues.push('Vergleichseinheit unsicher oder nicht ableitbar');
  }

  if (customerProgramRequired) {
    issues.push('Angebot erfordert Kundenprogramm oder App');
  }

  if (categoryDecision.needsReview) {
    issues.push(...categoryDecision.reviewReasons);
  }

  const completenessBase = [
    priceCurrentAmount,
    promotion.validFrom,
    promotion.validTo,
    comparisonCategory,
  ].filter(Boolean).length;
  const statusInfo = buildOfferStatus(
    promotion.validFrom ? new Date(promotion.validFrom) : null,
    promotion.validTo ? new Date(promotion.validTo) : null,
    Boolean(promotion.snapshotCurrent)
  );
  const hasConditions = Boolean(conditionsText || customerProgramRequired || (requirement?.requiredQuantity || 1) > 1);
  const isMultiBuy = ['x-plus-y', 'x-for-y', 'multi-buy'].includes(requirement?.mechanic);
  if (isMultiBuy || (requirement?.requiredQuantity || 1) > 1) {
    comparisonGroup = '';
  }
  const effectiveDiscountType = determineEffectiveDiscountType({
    benefitType: deriveBenefitType(promotion),
    customerProgramRequired,
    minimalAcceptance: parseNumericAmount(promotion.minimalAcceptance),
    requirement,
  });
  const quality = {
    completenessScore: completenessBase / 4,
    parsingConfidence: normalizedUnitPrice.comparable ? 0.9 : 0.82,
    comparisonSafe: normalizedUnitPrice.comparable && Boolean(comparisonGroup),
    issues,
  };
  const searchText = buildSearchText({
    retailerName,
    brand,
    title,
    titleNormalized,
    categoryPrimary,
    categorySecondary: comparisonCategory,
    categoryKey,
    categoryConfidence: categoryDecision.categoryConfidence,
    subcategoryConfidence: categoryDecision.subcategoryConfidence,
    quantityText,
    conditionsText,
  });
  const offerKey = [
    retailerKey,
    categoryKey,
    comparisonSignature || titleNormalized,
    buildComparisonAmountKey(comparableBase) || quantityText || 'na',
    String(priceCurrentAmount ?? 'na'),
    effectiveDiscountType,
    customerProgramRequired ? 'program' : 'public',
    promotion.validFrom ? new Date(promotion.validFrom).toISOString().slice(0, 10) : 'na',
    promotion.validTo ? new Date(promotion.validTo).toISOString().slice(0, 10) : 'na',
  ].join('::');
  const dedupeKey = [
    retailerKey,
    categoryKey,
    comparisonSignature || titleNormalized,
    buildComparisonAmountKey(comparableBase) || quantityText || 'na',
    effectiveDiscountType,
    customerProgramRequired ? 'program' : 'public',
    String(priceCurrentAmount ?? 'na'),
    promotion.validTo ? new Date(promotion.validTo).toISOString().slice(0, 10) : '',
  ].join('::');
  const benefitType = deriveBenefitType(promotion);

  const manualOverrideResult = applyManualCategoryOverridesToOfferSync({
    crawlJobId,
    sourceId,
    retailerKey,
    retailerName,
    region,
    offerKey,
    dedupeKey,
    title,
    titleNormalized,
    brand,
    searchText,
    categoryPrimary,
    categorySecondary: comparisonCategory,
    categoryKey,
    comparisonSignature,
    comparisonQuantityKey,
    comparisonCategoryKey: toAsciiLower(comparisonCategory || categoryPrimary).replace(/[^a-z0-9]+/g, '-'),
    comparisonGroup,
    description:
      promotion.description && promotion.description !== '$undefined'
        ? sanitizeWhitespace(promotion.description)
        : '',
    sourceUrl: safeClickoutUrl,
    imageUrl: promotion.image?.medium || promotion.image?.small || promotion.displayImage || '',
    supportingSources: [
      buildSourceEvidence({
        source: {
          _id: sourceId,
          channel: 'aggregator',
          sourceUrl,
        },
        observedUrl: safeClickoutUrl,
        matchType: 'primary',
      }),
    ],
    validFrom: promotion.validFrom ? new Date(promotion.validFrom) : null,
    validTo: promotion.validTo ? new Date(promotion.validTo) : null,
    status: statusInfo.status,
    isActiveNow: statusInfo.isActiveNow,
    isActiveToday: statusInfo.isActiveToday,
    benefitType,
    effectiveDiscountType,
    conditionsText,
    customerProgramRequired,
    hasConditions,
    isMultiBuy,
    minimumPurchaseQty: requirement?.requiredQuantity || 1,
    availabilityScope: region || 'Grossraum Graz',
    priceCurrent: {
      amount: priceCurrentAmount,
      currency: promotion.currency?.iso || 'EUR',
      originalText: priceCurrentAmount ? `${priceCurrentAmount} ${promotion.currency?.symbol || 'EUR'}` : '',
    },
    priceReference: {
      amount: priceReferenceAmount,
      currency: promotion.currency?.iso || 'EUR',
      originalText: priceReferenceAmount ? `${priceReferenceAmount} ${promotion.currency?.symbol || 'EUR'}` : '',
    },
    priceReferenceSource: priceReferenceAmount ? 'prospect' : '',
    priceReferenceConfidence: priceReferenceAmount ? 0.95 : 0,
    quantityText,
    packCount: structuredQuantityFields.packCount,
    unitValue: structuredQuantityFields.unitValue,
    unitType: structuredQuantityFields.unitType,
    totalComparableAmount: structuredQuantityFields.totalComparableAmount,
    comparableUnit: structuredQuantityFields.comparableUnit,
    packageType: structuredQuantityFields.packageType,
    normalizedUnitPrice,
    sortScoreDefault: buildSortScoreDefault({
      isActiveNow: statusInfo.isActiveNow,
      customerProgramRequired,
      hasConditions,
      isMultiBuy,
      quality,
      normalizedUnitPrice,
    }),
    normalizationVersion: 'v2',
    parserVersion: 'aktionsfinder-v2',
    quality,
    rawFacts: {
      ...buildCompactRawFacts({
        promotion,
        requirement,
        validityText,
        conditionsText,
      }),
      categoryConfidence: categoryDecision.categoryConfidence,
      subcategoryConfidence: categoryDecision.subcategoryConfidence,
      snapshotCurrent: Boolean(promotion.snapshotCurrent),
    },
    needsReview: issues.length > 0,
    reviewReasons: issues,
    adminReview: {
      status: issues.length > 0 ? 'pending' : 'reviewed',
      note: '',
      feedbackDigest: '',
    },
    scope: scopeDecision,
  });

  return manualOverrideResult.offer || null;
}

module.exports = {
  normalizePromotionToOffer,
};
