const { buildSourceEvidence, sanitizeWhitespace } = require('./sourceEvidence');

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

  if (productQuantity && productUnit) {
    const normalized = normalizeComparableQuantity(productQuantity, productUnit);
    const multiplier =
      packageQuantity && product?.packageQuantityUnit?.type === 'PACKAGING' && normalized.unit !== 'Stk'
        ? packageQuantity
        : 1;

    return {
      quantity: normalized.quantity ? Number((normalized.quantity * multiplier).toFixed(3)) : null,
      unit: normalized.unit,
      comparable: normalized.comparable,
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

function buildComparisonQuantityKey(comparableBase) {
  if (!comparableBase?.quantity || !comparableBase?.unit) {
    return '';
  }

  return `${String(comparableBase.quantity).replace('.', '_')}-${comparableBase.unit}`;
}

function determineCategory(productGroups = [], title = '') {
  const haystack = toAsciiLower(
    `${title} ${productGroups.map((group) => `${group.title} ${group.detailUrlPath || ''}`).join(' ')}`
  );

  if (/(bier|wein|wasser|saft|cola|getraenk|schaumwein|spirituose|whisky|limonade|kaffee|tee|sirup|eistee|smoothie|energydrink|rose|rotwein|weisswein|aperitif|digestif|schnaps|gin|vodka|likor|sekt|prosecco|milchgetraenk|joghurtgetraenk)/.test(haystack)) {
    return 'Getraenke';
  }

  if (/(shampoo|dusch|zahnpasta|zahnbuerste|aufsteckbuerste|deo|deodorant|hygiene|drogerie|kosmetik|seife|windel|toilettenpapier|hygienepapier|einlagen|binden|gesichtspflege|hautpflege)/.test(haystack)) {
    return 'Drogerie / Hygiene';
  }

  if (/(haushalt|reiniger|muellbeutel|geschirr|waschmittel|papier|kueche|haushalts|schwamm|folie|beutel|tabs|pads|spuelmittel|reinigungsgeraete|tuecher)/.test(haystack)) {
    return 'Haushalt';
  }

  return 'Lebensmittel';
}

function detectScopeDecision({ productGroups = [], title = '', categoryPrimary = '' }) {
  const haystack = toAsciiLower(
    `${title} ${categoryPrimary} ${productGroups.map((group) => group.title || '').join(' ')}`
  );
  const excludedPatterns = [
    {
      pattern: /(damenbekleidung|herrenbekleidung|kinderbekleidung|bekleidung|mode|shirt|hose|jacke|socke|schuh|sandale|pyjama|pullover|kleid|leggings|unterwaesche)/,
      reason: 'Bekleidung liegt ausserhalb des V1-Scope',
    },
    {
      pattern: /(pflanze|blume|orchidee|blumenerde|hochbeeterde|erde|kompost|gartenpflanze|gaertnern|topfpflanze|garten)/,
      reason: 'Pflanzen liegen ausserhalb des V1-Scope',
    },
    {
      pattern: /(werkzeug|akkuschrauber|bohrer|maschine|drucker|monitor|tablet|smartphone|kopfhoerer|fernseher|tv|notebook|laptop|kamera)/,
      reason: 'Technik und Werkzeug liegen ausserhalb des V1-Scope',
    },
    {
      pattern: /(spielzeug|fahrrad|autozubehoer|motoroel|reifen|sportartikel|camping)/,
      reason: 'Freizeit- und Sonderartikel liegen ausserhalb des V1-Scope',
    },
    {
      pattern: /(katzenfutter|hundefutter|tiernahrung|haustier|katzenstreu|katzenpflege|nassfutter|trockenfutter)/,
      reason: 'Tierbedarf liegt ausserhalb des V1-Scope',
    },
  ];

  for (const rule of excludedPatterns) {
    if (rule.pattern.test(haystack)) {
      return {
        included: false,
        reason: rule.reason,
      };
    }
  }

  const included = ['Lebensmittel', 'Getraenke', 'Drogerie / Hygiene', 'Haushalt'].includes(categoryPrimary);

  return {
    included,
    reason: included ? '' : 'Kategorie liegt ausserhalb des V1-Scope',
  };
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

function normalizePromotionToOffer({ promotion, retailerKey, retailerName, sourceId, crawlJobId, region, sourceUrl }) {
  const product = promotion.product || {};
  const productGroups = promotion.productGroups || product.productGroups || [];
  const priceCurrentAmount = parseNumericAmount(promotion.discountedPrice ?? promotion.newPrice);
  const comparableBase = buildComparableBase(product);
  const priceReferenceAmount = parseNumericAmount(promotion.originalPrice ?? promotion.oldPrice);
  const normalizedUnitPrice = buildNormalizedUnitPrice(promotion);
  const categoryPrimary = determineCategory(productGroups, promotion.title);
  const scopeDecision = detectScopeDecision({
    productGroups,
    title: promotion.title,
    categoryPrimary,
  });
  const quantityText = buildQuantityText(product);
  const conditionsText = buildConditionsText(promotion);
  const customerProgramRequired = detectCustomerProgramRequired(promotion);
  const issues = [];
  const comparisonCategory = sanitizeWhitespace(productGroups[0]?.title || categoryPrimary);
  const brand = sanitizeWhitespace(product.brand?.name || '');
  const comparisonQuantityKey = buildComparisonQuantityKey(comparableBase);
  const comparisonSignature = buildComparisonSignature({
    title: promotion.fullDisplayName || promotion.title,
    brand,
  });
  const safeClickoutUrl =
    typeof promotion.clickoutUrl === 'string' && promotion.clickoutUrl && promotion.clickoutUrl !== '$undefined'
      ? promotion.clickoutUrl
      : sourceUrl;

  if (!scopeDecision.included) {
    issues.push(scopeDecision.reason);
  }

  if (!priceCurrentAmount) {
    issues.push('Kein aktueller Preis erkannt');
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

  const completenessBase = [
    priceCurrentAmount,
    promotion.validFrom,
    promotion.validTo,
    comparisonCategory,
  ].filter(Boolean).length;

  return {
    crawlJobId,
    sourceId,
    retailerKey,
    retailerName,
    region,
    title: sanitizeWhitespace(promotion.fullDisplayName || promotion.title),
    brand,
    categoryPrimary,
    categorySecondary: comparisonCategory,
    comparisonSignature,
    comparisonQuantityKey,
    comparisonCategoryKey: toAsciiLower(comparisonCategory || categoryPrimary).replace(/[^a-z0-9]+/g, '-'),
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
    benefitType: deriveBenefitType(promotion),
    conditionsText,
    customerProgramRequired,
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
    quantityText,
    normalizedUnitPrice,
    quality: {
      completenessScore: completenessBase / 4,
      parsingConfidence: normalizedUnitPrice.comparable ? 0.9 : 0.82,
      comparisonSafe: normalizedUnitPrice.comparable && scopeDecision.included,
      issues,
    },
    rawFacts: {
      promotionId: promotion.id,
      promotionSlug: promotion.slug,
      productGroupTitles: productGroups.map((group) => group.title),
      minimalAcceptance: parseNumericAmount(promotion.minimalAcceptance),
      discountPercentage: parseNumericAmount(promotion.discountPercentage),
      comparableBase,
      rawProduct: product,
    },
    adminReview: {
      status: issues.length > 0 ? 'pending' : 'reviewed',
      note: '',
      feedbackDigest: '',
    },
    scope: scopeDecision,
  };
}

module.exports = {
  normalizePromotionToOffer,
};
