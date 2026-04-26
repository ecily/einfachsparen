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
  const plusMatch = rawText.match(/\b(\d+)\s*\+\s*(\d+)\b/i);

  if (plusMatch) {
    const buyQuantity = Number(plusMatch[1]);
    const freeQuantity = Number(plusMatch[2]);

    return {
      requiredQuantity: buyQuantity + freeQuantity,
      payableQuantity: buyQuantity,
      mechanic: 'x-plus-y',
    };
  }

  const haystack = normalizeTitleForMatch(rawText);
  const forMatch = rawText.match(/\b(\d+)\s*(?:fur|fuer|für)\s*(\d+)\b/i) || haystack.match(/\b(\d+)\s*(?:fur|fuer)\s*(\d+)\b/);

  if (forMatch) {
    return {
      requiredQuantity: Number(forMatch[1]),
      payableQuantity: Number(forMatch[2]),
      mechanic: 'x-for-y',
    };
  }

  const thresholdMatch = haystack.match(/\bab\s+(\d+)\s*(?:stk|stueck|stuck|dosen|flaschen|packungen|rollen|beutel|glaser|glaeser)\b/);

  if (thresholdMatch) {
    return {
      requiredQuantity: Number(thresholdMatch[1]),
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

function computeOfferSavings(offer = {}) {
  const priceCurrentAmount = parseNumericAmount(offer?.priceCurrent?.amount);
  const referenceLooksEstimated =
    offer?.savingsDisplayType === 'estimated-reference-price'
    || offer?.hasEstimatedReferencePrice === true
    || /estimated|history|historisch|product-search|produktseite|reference/i.test(String(offer?.priceReferenceSource || ''));
  const explicitReferenceAmount = referenceLooksEstimated
    ? null
    : parseNumericAmount(offer?.priceReference?.amount);
  const discountPercentage =
    parseNumericAmount(offer?.rawFacts?.discountPercentage)
    || parseNumericAmount(offer?.discountPercentage);
  const requirement = extractPromotionRequirement({
    title: offer?.title || '',
    conditionsText: offer?.conditionsText || '',
    rawFacts: offer?.rawFacts || {},
    benefitType: offer?.benefitType || '',
  });

  let referenceUnitPrice = explicitReferenceAmount;

  if (!referenceUnitPrice && priceCurrentAmount && discountPercentage && discountPercentage > 0 && discountPercentage < 100) {
    referenceUnitPrice = roundMoney(priceCurrentAmount / (1 - discountPercentage / 100));
  }

  if (!referenceUnitPrice || !priceCurrentAmount || referenceUnitPrice <= 0) {
    return {
      requiredQuantity: requirement.requiredQuantity,
      payableQuantity: requirement.payableQuantity,
      mechanic: requirement.mechanic,
      savingsAmount: null,
      savingsPercent: null,
      totalCurrentAmount: null,
      totalReferenceAmount: null,
    };
  }

  let totalReferenceAmount = referenceUnitPrice * requirement.requiredQuantity;
  let totalCurrentAmount = priceCurrentAmount * requirement.requiredQuantity;

  if (
    requirement.payableQuantity
    && requirement.requiredQuantity > 0
    && (!explicitReferenceAmount || priceCurrentAmount >= referenceUnitPrice)
  ) {
    totalCurrentAmount = referenceUnitPrice * requirement.payableQuantity;
  }

  const savingsAmount = totalReferenceAmount - totalCurrentAmount;

  if (!(savingsAmount > 0)) {
    return {
      requiredQuantity: requirement.requiredQuantity,
      payableQuantity: requirement.payableQuantity,
      mechanic: requirement.mechanic,
      savingsAmount: null,
      savingsPercent: null,
      totalCurrentAmount: roundMoney(totalCurrentAmount),
      totalReferenceAmount: roundMoney(totalReferenceAmount),
    };
  }

  return {
    requiredQuantity: requirement.requiredQuantity,
    payableQuantity: requirement.payableQuantity,
    mechanic: requirement.mechanic,
    savingsAmount: roundMoney(savingsAmount),
    savingsPercent: roundMoney((savingsAmount / totalReferenceAmount) * 100),
    totalCurrentAmount: roundMoney(totalCurrentAmount),
    totalReferenceAmount: roundMoney(totalReferenceAmount),
  };
}

module.exports = {
  computeOfferSavings,
  extractPromotionRequirement,
};
