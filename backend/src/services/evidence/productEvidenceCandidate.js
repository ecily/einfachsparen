const CONFIDENCE = Object.freeze({
  HARD: 'hard',
  MEDIUM: 'medium',
  WEAK: 'weak',
  REJECT: 'reject',
});

const TRANSPORT_NO_PUBLIC_REASONS = new Set([
  'blocked',
  'forbidden',
  'rate-limited',
  'zero-hit',
  'transport-error',
]);

function clean(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeText(value = '') {
  return clean(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\u00df/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeIdentity(value = '') {
  return clean(value).replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function normalizeQuantity(value = '') {
  const text = clean(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\u00df/g, 'ss')
    .replace(/,/g, '.')
    .replace(/[^a-z0-9.]+/g, ' ')
    .trim();
  const simple = text.match(/\b(\d+(?:\.\d+)?)\s*(ml|l|g|kg|stk|stueck|stuck|piece|pieces)\b/);
  if (!simple) return '';

  const amount = Number(simple[1]);
  const unit = simple[2];
  if (!Number.isFinite(amount)) return '';
  if (unit === 'l') return `${amount * 1000}ml`;
  if (unit === 'kg') return `${amount * 1000}g`;
  if (['stk', 'stueck', 'stuck', 'piece', 'pieces'].includes(unit)) return `${amount}stueck`;
  return `${amount}${unit}`;
}

function normalizeAllowedPublicUse(overrides = {}) {
  return {
    image: Boolean(overrides.image),
    metadata: Boolean(overrides.metadata),
    price: false,
    validity: false,
    condition: false,
  };
}

function hasHardIdentity(candidate = {}) {
  return Boolean(
    normalizeIdentity(candidate.productId)
      || normalizeIdentity(candidate.ean)
      || normalizeIdentity(candidate.gtin)
  );
}

function identitySignals(candidate = {}) {
  return {
    productId: normalizeIdentity(candidate.productId),
    slug: clean(candidate.slug),
    ean: normalizeIdentity(candidate.ean),
    gtin: normalizeIdentity(candidate.gtin),
  };
}

function evidenceTransportBlocksPublicUse(transportHealth = {}) {
  const status = Number(transportHealth.status || 0);
  const reason = clean(transportHealth.reason).toLowerCase();
  if ([403, 429, 1015].includes(status)) return true;
  if (transportHealth.zeroHits === true) return true;
  if (TRANSPORT_NO_PUBLIC_REASONS.has(reason)) return true;
  return false;
}

function buildBaseCandidate(candidate = {}) {
  return {
    evidenceSource: clean(candidate.evidenceSource),
    productId: clean(candidate.productId),
    slug: clean(candidate.slug),
    ean: clean(candidate.ean),
    gtin: clean(candidate.gtin),
    productName: clean(candidate.productName),
    brand: clean(candidate.brand),
    quantity: clean(candidate.quantity),
    category: clean(candidate.category),
    imageUrl: clean(candidate.imageUrl),
    productUrl: clean(candidate.productUrl),
    retailerFamily: clean(candidate.retailerFamily),
    matchSignals: {
      ...identitySignals(candidate),
      brandMatch: Boolean(candidate.matchSignals?.brandMatch),
      quantityMatch: Boolean(candidate.matchSignals?.quantityMatch),
      variantMatch: candidate.matchSignals?.variantMatch !== false,
      titleOnly: Boolean(candidate.matchSignals?.titleOnly),
      transportHealthy: candidate.matchSignals?.transportHealthy !== false,
    },
    confidence: CONFIDENCE.REJECT,
    allowedPublicUse: normalizeAllowedPublicUse(),
    rejectionReason: '',
  };
}

function evaluateProductEvidenceCandidate(candidate = {}, expected = {}, options = {}) {
  const result = buildBaseCandidate(candidate);
  const expectedBrand = normalizeText(expected.brand);
  const expectedQuantity = normalizeQuantity(expected.quantity);
  const candidateBrand = normalizeText(candidate.brand);
  const candidateQuantity = normalizeQuantity(candidate.quantity);
  const transportHealth = options.transportHealth || candidate.transportHealth || {};

  if (evidenceTransportBlocksPublicUse(transportHealth)) {
    return {
      ...result,
      rejectionReason: 'transport-health-no-public-use',
      matchSignals: {
        ...result.matchSignals,
        transportHealthy: false,
      },
    };
  }

  if (!hasHardIdentity(candidate)) {
    return {
      ...result,
      rejectionReason: 'missing-hard-product-identity',
      matchSignals: {
        ...result.matchSignals,
        titleOnly: true,
      },
    };
  }

  if (!clean(candidate.imageUrl)) {
    return {
      ...result,
      rejectionReason: 'missing-image-url',
    };
  }

  if (expectedBrand && candidateBrand !== expectedBrand) {
    return {
      ...result,
      rejectionReason: 'brand-mismatch',
    };
  }

  if (expectedQuantity && candidateQuantity !== expectedQuantity) {
    return {
      ...result,
      rejectionReason: 'quantity-mismatch',
      matchSignals: {
        ...result.matchSignals,
        brandMatch: true,
        quantityMatch: false,
      },
    };
  }

  if (candidate.matchSignals?.variantMatch === false) {
    return {
      ...result,
      rejectionReason: 'variant-not-proven',
      matchSignals: {
        ...result.matchSignals,
        brandMatch: true,
        quantityMatch: true,
        variantMatch: false,
      },
    };
  }

  return {
    ...result,
    confidence: CONFIDENCE.HARD,
    allowedPublicUse: normalizeAllowedPublicUse({ image: true, metadata: true }),
    rejectionReason: '',
    matchSignals: {
      ...result.matchSignals,
      brandMatch: true,
      quantityMatch: true,
      variantMatch: true,
      titleOnly: false,
      transportHealthy: true,
    },
  };
}

module.exports = {
  CONFIDENCE,
  evaluateProductEvidenceCandidate,
  evidenceTransportBlocksPublicUse,
  normalizeAllowedPublicUse,
  normalizeQuantity,
};
