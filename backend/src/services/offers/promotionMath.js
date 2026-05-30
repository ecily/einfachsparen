const { normalizeTitleForMatch } = require('../crawl/sourceEvidence');

function parseNumericAmount(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numeric = Number(
    String(value)
      .replace(/[^\d,.-]+/g, '')
      .replace(/\.(?=\d{3}(?:\D|$))/g, '')
      .replace(',', '.')
  );

  return Number.isFinite(numeric) ? numeric : null;
}

function roundMoney(value) {
  return Number(value.toFixed(2));
}

function toCents(amount) {
  const numericAmount = Number(amount);

  return Number.isFinite(numericAmount) ? Math.round(numericAmount * 100) : 0;
}

function fromCents(cents) {
  return roundMoney(cents / 100);
}

function firstNumericAmount(values = []) {
  for (const value of values) {
    const numeric = parseNumericAmount(value);

    if (numeric !== null) {
      return numeric;
    }
  }

  return null;
}

function getDiscountPercent(offer = {}) {
  const discountPercent = firstNumericAmount([
    offer?.rawFacts?.discountPercentage,
    offer?.rawFacts?.discountPercent,
    offer?.discountPercentage,
    offer?.discountPercent,
    offer?.referencePrice?.discountPercent,
  ]);

  return discountPercent && discountPercent > 0 && discountPercent < 100 ? discountPercent : null;
}

function isCampaignLevelDiscount(offer = {}) {
  const rawFacts = offer?.rawFacts || {};

  return (
    rawFacts.discountScope === 'campaign'
    || rawFacts.discountLevel === 'campaign'
    || rawFacts.isCampaignDiscount === true
    || rawFacts.discountAppliesToProduct === false
  );
}

function normalizeSourceText(offer = {}) {
  return normalizeTitleForMatch([
    offer?.priceReferenceSource,
    offer?.rawFacts?.priceReferenceSource,
    offer?.rawFacts?.referencePriceSource,
    offer?.rawFacts?.referencePriceType,
    offer?.savingsDisplayType,
    offer?.rawFacts?.savingsDisplayType,
  ].join(' '));
}

function inferReferenceType({ offer = {}, explicitReferenceAmount = null, discountPercent = null } = {}) {
  const sourceText = normalizeSourceText(offer);

  if (
    /\bdiscount\s+percent\b/.test(sourceText)
    || /\bpercent\s+derived\b/.test(sourceText)
    || /\bpercentage\s+derived\b/.test(sourceText)
    || /\bsource\s+percent\b/.test(sourceText)
  ) {
    return 'source_percent_derived';
  }

  if (!explicitReferenceAmount && discountPercent) {
    return 'source_percent_derived';
  }

  if (
    sourceText.includes('external')
    || sourceText.includes('other retailer')
    || sourceText.includes('cross retailer')
    || sourceText.includes('vergleich')
  ) {
    return 'external_comparison';
  }

  if (
    sourceText.includes('same retailer')
    || sourceText.includes('regular price')
    || sourceText.includes('same_retailer_regular_price')
  ) {
    return 'same_retailer_regular_price';
  }

  if (
    sourceText.includes('estimated reference price')
    || sourceText.includes('estimated')
    || sourceText.includes('history')
    || sourceText.includes('historisch')
    || sourceText.includes('product search')
    || sourceText.includes('produktseite')
    || sourceText.includes('reference')
    || sourceText.includes('referenz')
  ) {
    return 'estimated_reference_price';
  }

  return explicitReferenceAmount ? 'direct_source_reference_price' : 'none';
}

function allowsSavingsForReferenceType(type) {
  return [
    'direct_source_reference_price',
    'source_percent_derived',
    'same_retailer_regular_price',
  ].includes(type);
}

function referenceTypeSource(type, offer = {}) {
  if (offer?.priceReferenceSource) return offer.priceReferenceSource;

  if (type === 'source_percent_derived') return 'discount-percent-derived';
  if (type === 'direct_source_reference_price') return 'source';
  if (type === 'same_retailer_regular_price') return 'same-retailer-regular-price';
  if (type === 'external_comparison') return 'external-comparison';

  return '';
}

function referenceConfidence({ type, offer = {} } = {}) {
  const explicitConfidence = parseNumericAmount(offer?.priceReferenceConfidence);

  if (explicitConfidence !== null && explicitConfidence > 0) {
    return explicitConfidence;
  }

  if (type === 'direct_source_reference_price') return 0.95;
  if (type === 'source_percent_derived') return 0.72;
  if (type === 'same_retailer_regular_price') return 0.86;
  if (type === 'external_comparison') return 0.7;
  if (type === 'estimated_reference_price') return 0.55;

  return 0;
}

function buildReferenceLabel(reference = {}, currency = 'EUR', retailerName = '') {
  if (!reference?.amount) return '';

  const amount = `${roundMoney(reference.amount).toFixed(2)} ${currency || 'EUR'}`;

  if (reference.type === 'direct_source_reference_price') {
    return `statt ${amount}`;
  }

  if (reference.type === 'source_percent_derived' && reference.discountPercent) {
    return `Normalpreis ca. ${amount} laut -${reference.discountPercent}%-Angabe`;
  }

  if (reference.type === 'same_retailer_regular_price') {
    return `Normalpreis bei ${retailerName || 'diesem Haendler'} ${amount}`;
  }

  if (reference.type === 'external_comparison') {
    return `Kostet woanders ca. ${amount}`;
  }

  return `Referenzpreis ca. ${amount}`;
}

function resolveReferencePrice(offer = {}) {
  const currentAmount = parseNumericAmount(offer?.priceCurrent?.amount);
  const explicitReferenceAmount = parseNumericAmount(offer?.priceReference?.amount);
  const discountPercent = isCampaignLevelDiscount(offer) ? null : getDiscountPercent(offer);
  let amount = explicitReferenceAmount;
  let type = inferReferenceType({ offer, explicitReferenceAmount, discountPercent });

  if ((!amount || !(amount > currentAmount)) && currentAmount && discountPercent && type === 'source_percent_derived') {
    amount = roundMoney(currentAmount / (1 - discountPercent / 100));
  }

  if (!amount || amount <= 0 || (currentAmount && amount <= currentAmount)) {
    return {
      amount: null,
      type: 'none',
      source: '',
      confidence: 0,
      discountPercent: discountPercent || null,
      isApproximate: false,
      allowsSavings: false,
      label: '',
    };
  }

  if (type === 'none') {
    type = inferReferenceType({ offer, explicitReferenceAmount: amount, discountPercent });
  }

  const isApproximate = [
    'source_percent_derived',
    'external_comparison',
    'estimated_reference_price',
  ].includes(type);
  const currency = offer?.priceReference?.currency || offer?.priceCurrent?.currency || 'EUR';
  const confidence = referenceConfidence({ type, offer });
  const reference = {
    amount: roundMoney(amount),
    type,
    source: referenceTypeSource(type, offer),
    confidence,
    discountPercent: discountPercent || null,
    isApproximate,
    allowsSavings: allowsSavingsForReferenceType(type),
  };

  return {
    ...reference,
    label: buildReferenceLabel(reference, currency, offer?.retailerName),
  };
}

function buildSavingsBasis(reference = {}) {
  if (reference.type === 'direct_source_reference_price') return 'direct_source_reference_price';
  if (reference.type === 'source_percent_derived') return 'source_discount_percent';
  if (reference.type === 'same_retailer_regular_price') return 'same_retailer_regular_price';

  return 'none';
}

function buildSavingsLabel({ savingsAmount, reference, currency = 'EUR' } = {}) {
  if (!(savingsAmount > 0)) {
    return 'Aktionspreis';
  }

  const amount = `${roundMoney(savingsAmount).toFixed(2)} ${currency || 'EUR'}`;

  return reference?.isApproximate ? `Spart ca. ${amount}` : `Spart ${amount}`;
}

function isSunProtectionPlusContext(value, matchIndex = 0) {
  const text = String(value || '').toLowerCase();
  const prefix = text.slice(Math.max(0, matchIndex - 36), matchIndex);

  return /\b(?:lsf|spf|sonnenschutzfaktor|schutzfaktor)\s*$/i.test(prefix);
}

function extractPromotionRequirement({ title = '', conditionsText = '', rawFacts = {}, benefitType = '' }) {
  const rawMinimum =
    parseNumericAmount(rawFacts?.minimalAcceptance)
    || parseNumericAmount(rawFacts?.minimumPurchaseQuantity)
    || parseNumericAmount(rawFacts?.requiredQuantity);

  if (rawMinimum && rawMinimum > 1) {
    return {
      requiredQuantity: rawMinimum,
      payableQuantity: null,
      mechanic: 'threshold',
    };
  }

  const tagHaystack = [
    ...(Array.isArray(rawFacts?.tags) ? rawFacts.tags : []),
    ...(Array.isArray(rawFacts?.loyaltyTags) ? rawFacts.loyaltyTags : []),
  ].join(' ');
  const tagPlusMatch = tagHaystack.match(/\b(?:pt-)?(\d+)plus(\d+)\b/i);

  if (tagPlusMatch) {
    const payableQuantity = Number(tagPlusMatch[1]);
    const freeQuantity = Number(tagPlusMatch[2]);

    return {
      requiredQuantity: payableQuantity + freeQuantity,
      payableQuantity,
      mechanic: 'x-plus-y',
    };
  }

  const rawText = `${title} ${conditionsText}`;
  for (const plusMatch of rawText.matchAll(/(?=\b(\d+)\s*\+\s*(\d+)\b)/gi)) {
    if (isSunProtectionPlusContext(rawText, plusMatch.index || 0)) {
      continue;
    }

    const buyQuantity = Number(plusMatch[1]);
    const freeQuantity = Number(plusMatch[2]);

    return {
      requiredQuantity: buyQuantity + freeQuantity,
      payableQuantity: buyQuantity,
      mechanic: 'x-plus-y',
    };
  }

  const haystack = normalizeTitleForMatch(rawText);
  const forMatch = haystack.match(/\b(\d+)\s*(?:fur|fuer)\s*(\d+)\b/);

  if (forMatch) {
    return {
      requiredQuantity: Number(forMatch[1]),
      payableQuantity: Number(forMatch[2]),
      mechanic: 'x-for-y',
    };
  }

  const nimmMatch = haystack.match(/\bnimm\s+(\d+)\s+zahl\s+(\d+)\b/);

  if (nimmMatch) {
    return {
      requiredQuantity: Number(nimmMatch[1]),
      payableQuantity: Number(nimmMatch[2]),
      mechanic: 'x-for-y',
    };
  }

  const thresholdMatch = haystack.match(/\bab\s+(\d+)\s*(?:stk|stueck|stuck|pkg|dosen|flaschen|packungen|rollen|beutel|glaser|glaeser)\b/);

  if (thresholdMatch) {
    return {
      requiredQuantity: Number(thresholdMatch[1]),
      payableQuantity: null,
      mechanic: 'threshold',
    };
  }

  const purchaseMatch = haystack.match(/\b(?:beim\s+kauf\s+von|bei\s+kauf\s+von|kauf\s+von|kauf)\s+(\d+)\b/);

  if (purchaseMatch) {
    return {
      requiredQuantity: Number(purchaseMatch[1]),
      payableQuantity: null,
      mechanic: 'threshold',
    };
  }

  if (benefitType === 'multi-buy') {
    return {
      requiredQuantity: 2,
      payableQuantity: null,
      mechanic: 'multi-buy',
    };
  }

  return {
    requiredQuantity: 1,
    payableQuantity: null,
    mechanic: 'single',
  };
}

function extractPlusFreeRequirementFromText(offer = {}) {
  const rawText = `${offer?.title || ''} ${offer?.conditionsText || ''}`;

  for (const plusMatch of rawText.matchAll(/(?=\b(\d+)\s*\+\s*(\d+)\b)/gi)) {
    if (isSunProtectionPlusContext(rawText, plusMatch.index || 0)) {
      continue;
    }

    const buyQuantity = Number(plusMatch[1]);
    const freeQuantity = Number(plusMatch[2]);

    if (
      Number.isFinite(buyQuantity)
      && Number.isFinite(freeQuantity)
      && buyQuantity > 0
      && freeQuantity > 0
    ) {
      return {
        requiredQuantity: buyQuantity + freeQuantity,
        payableQuantity: buyQuantity,
        mechanic: 'x-plus-y',
      };
    }
  }

  return null;
}

function isBlockOrMultibuyRequirement(offer = {}, requirement = {}) {
  const text = normalizeTitleForMatch([
    offer?.title,
    offer?.conditionsText,
    offer?.conditionLabel,
    offer?.discountMechanic,
    offer?.discountType,
    offer?.effectiveDiscountType,
    offer?.benefitType,
    offer?.rawFacts,
  ].join(' '));

  return (
    Boolean(offer?.isMultiBuy)
    || ['multi-buy', 'x-plus-y', 'x-for-y', 'threshold'].includes(requirement.mechanic)
    || Number(requirement.requiredQuantity || 1) > 1
    || /\b\d+\s*\+\s*\d+\b/.test(text)
    || /\b\d+\s*(?:fur|fuer)\s*\d+\b/.test(text)
    || /\b(?:gratis|ab\s+\d+|bei\s+\d+)\b/.test(text)
  );
}

function isUnsafeBlockReference({ offer = {}, reference = {}, priceCurrentAmount = null, requirement = {} } = {}) {
  if (!reference?.allowsSavings || !(reference.amount > 0) || !(priceCurrentAmount > 0)) {
    return false;
  }

  return isBlockOrMultibuyRequirement(offer, requirement) && reference.amount / priceCurrentAmount > 3;
}

function buildNoSavingsResult({ requirement = {}, reference = {}, isApproximate = false } = {}) {
  return {
    requiredQuantity: requirement.requiredQuantity,
    payableQuantity: requirement.payableQuantity,
    mechanic: requirement.mechanic,
    referencePrice: reference,
    savingsAmount: null,
    savingsPercent: null,
    savings: {
      amount: null,
      percent: null,
      isApproximate,
      basis: 'none',
      label: 'Aktionspreis',
    },
    totalCurrentAmount: null,
    totalReferenceAmount: null,
  };
}

function buildUnsafeBlockReference(reference = {}) {
  return {
    ...reference,
    amount: null,
    type: 'none',
    source: '',
    confidence: 0,
    isApproximate: false,
    allowsSavings: false,
    label: '',
    unsafeReason: 'block-reference-price-not-unit-safe',
  };
}

function computeDerivedPlusSavings({ offer = {}, priceCurrentAmount = null, reference = {}, requirement = {} } = {}) {
  const plusRequirement = requirement.mechanic === 'x-plus-y'
    ? requirement
    : extractPlusFreeRequirementFromText(offer);
  const effectiveRequirement = plusRequirement
    ? {
      ...plusRequirement,
      requiredQuantity: Math.max(
        Number(plusRequirement.requiredQuantity || 0),
        Number(requirement.requiredQuantity || 0),
      ),
    }
    : requirement;

  if (
    effectiveRequirement.mechanic !== 'x-plus-y'
    || !(effectiveRequirement.requiredQuantity > 0)
    || !(effectiveRequirement.payableQuantity > 0)
    || effectiveRequirement.payableQuantity >= effectiveRequirement.requiredQuantity
    || !(priceCurrentAmount > 0)
  ) {
    return null;
  }

  const requiredQuantity = Math.round(effectiveRequirement.requiredQuantity);
  const payableQuantity = Math.round(effectiveRequirement.payableQuantity);
  const freeQuantity = requiredQuantity - payableQuantity;
  const currentUnitCents = toCents(priceCurrentAmount);
  const inferredNormalUnitCents = Math.round((currentUnitCents * requiredQuantity) / payableQuantity);
  const totalCurrentCents = currentUnitCents * requiredQuantity;
  const totalReferenceCents = inferredNormalUnitCents * requiredQuantity;
  const savingsCents = inferredNormalUnitCents * freeQuantity;

  if (!(savingsCents > 0) || !(totalReferenceCents > totalCurrentCents)) {
    return null;
  }

  const savingsAmount = fromCents(savingsCents);
  const savingsPercent = roundMoney((savingsCents / totalReferenceCents) * 100);
  const currency = offer?.priceCurrent?.currency || offer?.priceReference?.currency || 'EUR';
  const safeReference = buildUnsafeBlockReference(reference);

  return {
    requiredQuantity,
    payableQuantity,
    mechanic: requirement.mechanic,
    referencePrice: safeReference,
    savingsAmount,
    savingsPercent,
    savings: {
      amount: savingsAmount,
      percent: savingsPercent,
      isApproximate: true,
      basis: 'derived_x_plus_y_block',
      label: buildSavingsLabel({ savingsAmount, reference: { isApproximate: true }, currency }),
    },
    totalCurrentAmount: fromCents(totalCurrentCents),
    totalReferenceAmount: fromCents(totalReferenceCents),
    unsafeReferenceSuppressed: true,
  };
}

function computeOfferSavings(offer = {}) {
  const priceCurrentAmount = parseNumericAmount(offer?.priceCurrent?.amount);
  const reference = resolveReferencePrice(offer);
  const requirement = extractPromotionRequirement({
    title: offer?.title || '',
    conditionsText: offer?.conditionsText || '',
    rawFacts: offer?.rawFacts || {},
    benefitType: offer?.benefitType || '',
  });

  const referenceUnitPrice = reference.allowsSavings ? reference.amount : null;

  if (isUnsafeBlockReference({ offer, reference, priceCurrentAmount, requirement })) {
    const derivedSavings = computeDerivedPlusSavings({
      offer,
      priceCurrentAmount,
      reference,
      requirement,
    });

    if (derivedSavings) {
      return derivedSavings;
    }

    return {
      ...buildNoSavingsResult({
        requirement,
        reference: buildUnsafeBlockReference(reference),
        isApproximate: false,
      }),
      unsafeReferenceSuppressed: true,
    };
  }

  if (!referenceUnitPrice || !priceCurrentAmount || referenceUnitPrice <= 0) {
    return buildNoSavingsResult({ requirement, reference, isApproximate: false });
  }

  let totalReferenceAmount = referenceUnitPrice * requirement.requiredQuantity;
  let totalCurrentAmount = priceCurrentAmount * requirement.requiredQuantity;

  if (
    requirement.payableQuantity
    && requirement.requiredQuantity > 0
    && (reference.type === 'source_percent_derived' || priceCurrentAmount >= referenceUnitPrice)
  ) {
    totalCurrentAmount = referenceUnitPrice * requirement.payableQuantity;
  }

  const savingsAmount = totalReferenceAmount - totalCurrentAmount;

  if (!(savingsAmount > 0)) {
    return {
      requiredQuantity: requirement.requiredQuantity,
      payableQuantity: requirement.payableQuantity,
      mechanic: requirement.mechanic,
      referencePrice: reference,
      savingsAmount: null,
      savingsPercent: null,
      savings: {
        amount: null,
        percent: null,
        isApproximate: reference.isApproximate,
        basis: 'none',
        label: 'Aktionspreis',
      },
      totalCurrentAmount: roundMoney(totalCurrentAmount),
      totalReferenceAmount: roundMoney(totalReferenceAmount),
    };
  }

  const roundedSavingsAmount = roundMoney(savingsAmount);
  const savingsPercent = reference.type === 'source_percent_derived' && reference.discountPercent
    ? roundMoney(reference.discountPercent)
    : roundMoney((savingsAmount / totalReferenceAmount) * 100);
  const currency = offer?.priceCurrent?.currency || offer?.priceReference?.currency || 'EUR';

  return {
    requiredQuantity: requirement.requiredQuantity,
    payableQuantity: requirement.payableQuantity,
    mechanic: requirement.mechanic,
    referencePrice: reference,
    savingsAmount: roundedSavingsAmount,
    savingsPercent,
    savings: {
      amount: roundedSavingsAmount,
      percent: savingsPercent,
      isApproximate: reference.isApproximate,
      basis: buildSavingsBasis(reference),
      label: buildSavingsLabel({ savingsAmount: roundedSavingsAmount, reference, currency }),
    },
    totalCurrentAmount: roundMoney(totalCurrentAmount),
    totalReferenceAmount: roundMoney(totalReferenceAmount),
  };
}

module.exports = {
  computeOfferSavings,
  extractPromotionRequirement,
  getDiscountPercent,
  isSunProtectionPlusContext,
  isCampaignLevelDiscount,
  resolveReferencePrice,
};
