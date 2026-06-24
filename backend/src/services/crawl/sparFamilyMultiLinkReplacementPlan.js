const DEFAULT_STOP_RULES = Object.freeze({
  minBaseline: 10,
  minReplacementRatio: 0.65,
  minAbsoluteDrop: 8,
  maxFragmentTitleCount: 3,
  maxFragmentTitleRatio: 0.2,
  maxOffersWithoutPriceCount: 0,
  maxOffersWithoutPriceRatio: 0,
  maxOffersPerRawCandidateRatio: 1.25,
  maxOffersPerLink: 80,
});

const BLOCKED_HTTP_STATUSES = new Set([401, 403, 407, 429, 451]);
const FRAGMENT_REASONS = new Set([
  'generic-fragment-title',
  'layout-fragment',
  'condition-only-fragment',
  'noise-text-instead-of-title',
]);

function cleanString(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeKey(value) {
  return cleanString(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00df/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function number(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function isPresentDate(value) {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}

function normalizeValidity(validity = {}) {
  return {
    validFrom: validity.validFrom || null,
    validTo: validity.validTo || null,
  };
}

function hasValidity(value = {}) {
  const validity = normalizeValidity(value);
  return isPresentDate(validity.validFrom) && isPresentDate(validity.validTo);
}

function isTransportBlocked(link = {}) {
  const parseResult = link.parseResult || {};
  const status = number(parseResult.httpStatus ?? link.httpStatus, 0);
  const fetchStatus = cleanString(parseResult.fetchStatus || link.fetchStatus).toLowerCase();
  const parseStatus = cleanString(parseResult.status || link.status).toLowerCase();

  return BLOCKED_HTTP_STATUSES.has(status)
    || ['blocked', 'fetchfailed', 'fetch-failed', 'transport-error', 'failed'].includes(fetchStatus)
    || ['blocked', 'transport-error'].includes(parseStatus);
}

function countRejectionReason(rejectionReasons = [], reasonSet = FRAGMENT_REASONS) {
  return (Array.isArray(rejectionReasons) ? rejectionReasons : [])
    .filter(Boolean)
    .reduce((sum, item) => {
      const reason = cleanString(item.reason || item);
      return reasonSet.has(reason) ? sum + number(item.count ?? 1, 1) : sum;
    }, 0);
}

function looksLikeFragmentTitle(title = '') {
  const text = cleanString(title);
  return /^[-+%.\d\s]+/.test(text)
    || /^gratis\S/i.test(text)
    || /\b(?:bis zu|rabattmarke|rabattmarkerl)\b/i.test(text);
}

function offerHasPrice(offer = {}) {
  const amount = offer.priceCurrent?.amount ?? offer.price ?? offer.currentPrice;
  return Number.isFinite(Number(amount)) && Number(amount) > 0;
}

function buildOfferDedupeKey(offer = {}) {
  return cleanString(
    offer.dedupeKey
    || offer.offerKey
    || [
      offer.retailerFormat || offer.sourceRetailerFormat || offer.retailerKey,
      offer.title,
      offer.quantityText,
      offer.priceCurrent?.amount ?? offer.price ?? offer.currentPrice,
      offer.validFrom,
      offer.validTo,
    ].map(normalizeKey).join('|')
  );
}

function attachLinkEvidence(offer = {}, link = {}, group = {}) {
  const sourceUrlClass = cleanString(link.urlClass || link.url);
  const validity = normalizeValidity(offer.validFrom || offer.validTo ? offer : link.validity);

  return {
    ...offer,
    sourceKey: offer.sourceKey || group.sourceKey,
    sourceRetailerFormat: offer.sourceRetailerFormat || group.retailerFormat,
    retailerFormat: offer.retailerFormat || group.retailerFormat,
    region: offer.region || group.region,
    folderType: offer.folderType || link.folderType || '',
    sourceUrlClass,
    sourceUrl: offer.sourceUrl || sourceUrlClass,
    validFrom: offer.validFrom || validity.validFrom,
    validTo: offer.validTo || validity.validTo,
    rawFacts: {
      ...(offer.rawFacts || {}),
      sourceKey: offer.rawFacts?.sourceKey || group.sourceKey,
      sourceRetailerFormat: offer.rawFacts?.sourceRetailerFormat || group.retailerFormat,
      region: offer.rawFacts?.region || group.region,
      folderType: offer.rawFacts?.folderType || link.folderType || '',
      sourceUrlClass,
    },
  };
}

function dedupeOffersAcrossLinks(offers = []) {
  const byKey = new Map();
  const duplicates = [];

  for (const offer of offers) {
    const key = buildOfferDedupeKey(offer);
    if (!key) {
      byKey.set(`no-key-${byKey.size}`, offer);
      continue;
    }

    if (byKey.has(key)) {
      duplicates.push({ key, keptTitle: byKey.get(key).title || '', droppedTitle: offer.title || '' });
      continue;
    }

    byKey.set(key, offer);
  }

  return {
    offers: [...byKey.values()],
    duplicates,
  };
}

function evaluateCoverageGuard({ baselineStoredCount = 0, nextCount = 0, stopRules = {} } = {}) {
  const rules = { ...DEFAULT_STOP_RULES, ...(stopRules || {}) };
  const baseline = number(baselineStoredCount, 0);
  const incoming = number(nextCount, 0);

  if (baseline < rules.minBaseline) {
    return {
      blocked: false,
      reason: '',
      baselineStoredCount: baseline,
      nextCount: incoming,
    };
  }

  const replacementRatio = baseline > 0 ? incoming / baseline : 1;
  const absoluteDrop = baseline - incoming;
  const blocked = incoming < Math.ceil(baseline * rules.minReplacementRatio)
    && absoluteDrop >= rules.minAbsoluteDrop;

  return {
    blocked,
    reason: blocked ? 'coverage-drop' : '',
    baselineStoredCount: baseline,
    nextCount: incoming,
    replacementRatio,
    absoluteDrop,
    minReplacementRatio: rules.minReplacementRatio,
    minAbsoluteDrop: rules.minAbsoluteDrop,
  };
}

function buildSparFamilyMultiLinkReplacementPlan({
  group = {},
  links = [],
  stopRules = {},
} = {}) {
  const rules = { ...DEFAULT_STOP_RULES, ...(stopRules || {}) };
  const normalizedGroup = {
    retailerFormat: cleanString(group.retailerFormat),
    region: cleanString(group.region),
    sourceKey: cleanString(group.sourceKey),
  };
  const replacementScope = {
    retailerFormat: normalizedGroup.retailerFormat,
    region: normalizedGroup.region,
    sourceKey: normalizedGroup.sourceKey,
  };
  const stopReasons = [];
  const linkDiagnostics = [];
  const collectedOffers = [];
  let rawCandidateCount = 0;
  let fragmentTitleCount = 0;

  for (const link of Array.isArray(links) ? links : []) {
    const parseResult = link.parseResult || {};
    const offers = Array.isArray(parseResult.offers) ? parseResult.offers : [];
    const linkRawCandidates = number(parseResult.rawCandidateCount, offers.length);
    const linkFragmentCount = countRejectionReason(parseResult.rejectionReasons);
    const blocked = isTransportBlocked(link);
    const linkValidity = normalizeValidity(link.validity || {});

    rawCandidateCount += linkRawCandidates;
    fragmentTitleCount += linkFragmentCount;

    if (blocked) {
      stopReasons.push('transport-blocked');
    }

    if (!hasValidity(linkValidity)) {
      stopReasons.push('missing-validity');
    }

    for (const offer of offers) {
      const enriched = attachLinkEvidence(offer, { ...link, validity: linkValidity }, normalizedGroup);
      if (looksLikeFragmentTitle(enriched.title)) {
        fragmentTitleCount += 1;
      }
      if (!hasValidity(enriched)) {
        stopReasons.push('missing-validity');
      }
      collectedOffers.push(enriched);
    }

    linkDiagnostics.push({
      urlClass: cleanString(link.urlClass || link.url),
      folderType: cleanString(link.folderType),
      parsedOffers: offers.length,
      rawCandidateCount: linkRawCandidates,
      fragmentTitleCount: linkFragmentCount,
      blocked,
      validity: linkValidity,
    });
  }

  const dedupe = dedupeOffersAcrossLinks(collectedOffers);
  const offersWithoutPrice = dedupe.offers.filter((offer) => !offerHasPrice(offer)).length;
  const parsedOfferCount = dedupe.offers.length;
  const fragmentRatio = rawCandidateCount > 0 ? fragmentTitleCount / rawCandidateCount : 0;
  const offersWithoutPriceRatio = parsedOfferCount > 0 ? offersWithoutPrice / parsedOfferCount : 0;
  const offersPerRawCandidateRatio = rawCandidateCount > 0 ? collectedOffers.length / rawCandidateCount : collectedOffers.length;
  const coverageGuard = evaluateCoverageGuard({
    baselineStoredCount: group.baselineStoredCount,
    nextCount: parsedOfferCount,
    stopRules: rules,
  });

  if (parsedOfferCount === 0) {
    stopReasons.push('zero-parsed-offers');
  }

  if (coverageGuard.blocked) {
    stopReasons.push('coverage-drop');
  }

  if (fragmentTitleCount > rules.maxFragmentTitleCount || fragmentRatio > rules.maxFragmentTitleRatio) {
    stopReasons.push('fragment-heavy');
  }

  if (offersWithoutPrice > rules.maxOffersWithoutPriceCount || offersWithoutPriceRatio > rules.maxOffersWithoutPriceRatio) {
    stopReasons.push('offers-without-price');
  }

  if (
    offersPerRawCandidateRatio > rules.maxOffersPerRawCandidateRatio
    || (links.length > 0 && collectedOffers.length / links.length > rules.maxOffersPerLink)
  ) {
    stopReasons.push('parser-explosion');
  }

  const uniqueStopReasons = [...new Set(stopReasons)];
  const ready = uniqueStopReasons.length === 0;

  return {
    diagnosticOnly: true,
    productionEnabled: false,
    replacementScope,
    status: ready ? 'ready-for-atomic-replacement' : 'blocked',
    shouldReplaceOnce: ready,
    plannedReplaceCallCount: ready ? 1 : 0,
    partialReplacementAllowed: false,
    previousDataRetention: ready ? 'replace-after-all-links-accepted' : 'keep-existing',
    offerDocuments: ready ? dedupe.offers : [],
    combinedOfferCount: parsedOfferCount,
    collectedOfferCount: collectedOffers.length,
    rawCandidateCount,
    duplicateCount: dedupe.duplicates.length,
    duplicates: dedupe.duplicates,
    stopReasons: uniqueStopReasons,
    coverageGuard,
    diagnostics: {
      linkDiagnostics,
      fragmentTitleCount,
      fragmentRatio,
      offersWithoutPrice,
      offersWithoutPriceRatio,
      offersPerRawCandidateRatio,
    },
  };
}

module.exports = {
  DEFAULT_STOP_RULES,
  buildOfferDedupeKey,
  buildSparFamilyMultiLinkReplacementPlan,
  dedupeOffersAcrossLinks,
  evaluateCoverageGuard,
};
