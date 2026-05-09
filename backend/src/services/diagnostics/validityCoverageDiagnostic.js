const TARGET_VALIDITY_GROUPS = [
  { retailerKey: 'spar', sourceType: 'aktionsfinder-json' },
  { retailerKey: 'spar', sourceType: 'spar-ipaper-pdf-textlayer' },
  { retailerKey: 'interspar', sourceType: 'aktionsfinder-json' },
  { retailerKey: 'eurospar', sourceType: 'aktionsfinder-json' },
  { retailerKey: 'spar-aggregate', sourceType: 'aktionsfinder-json' },
  { retailerKey: 'billa', sourceType: 'billa-official-algolia' },
  { retailerKey: 'billa', sourceType: 'aktionsfinder-json' },
  { retailerKey: 'billa-plus', sourceType: 'billa-official-algolia' },
  { retailerKey: 'billa-plus', sourceType: 'aktionsfinder-json' },
  { retailerKey: 'penny', sourceType: 'penny-official-html' },
  { retailerKey: 'penny', sourceType: 'aktionsfinder-json' },
  { retailerKey: 'hofer', sourceType: 'aktionsfinder-json' },
  { retailerKey: 'lidl', sourceType: 'lidl-official-flyer-api' },
  { retailerKey: 'dm', sourceType: 'aktionsfinder-json' },
  { retailerKey: 'bipa', sourceType: 'aktionsfinder-json' },
  { retailerKey: 'adeg', sourceType: 'unknown', disabled: true },
];

const RECOVERY_STATUSES = [
  'already_safe',
  'safely_recoverable_from_explicit_offer_text',
  'safely_recoverable_from_validity_label',
  'conditional_source_context_only',
  'unsafe_fetched_or_observed_time',
  'missing',
];

function dateKey(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function pct(part, total) {
  return total > 0 ? Number(((part / total) * 100).toFixed(1)) : 0;
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean))];
}

function truncate(value, maxLength = 180) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function stringifySignal(value) {
  if (!value) return '';
  if (value instanceof Date) return dateKey(value);
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function collectRawValiditySignals(offer = {}) {
  const rawFacts = offer.rawFacts || {};
  const metadata = rawFacts.sourceMetadata || {};
  const values = [
    rawFacts.validity,
    rawFacts.validityText,
    rawFacts.validityLabel,
    rawFacts.validFrom,
    rawFacts.validTo,
    rawFacts.validityFrom,
    rawFacts.validityTo,
    rawFacts.offerStartDate,
    rawFacts.offerEndDate,
    rawFacts.detectedLeafletDates,
    metadata.validity,
    metadata.validityText,
    metadata.validFrom,
    metadata.validTo,
  ];

  return unique(values.map(stringifySignal));
}

function collectValidityLabels(offer = {}) {
  const rawFacts = offer.rawFacts || {};
  return unique([
    offer.validityLabel,
    rawFacts.validityLabel,
    rawFacts.validityText,
    rawFacts.validity,
  ].map(stringifySignal));
}

function collectSourceTitleSignals({ offer = {}, source = {}, rawDocuments = [] } = {}) {
  return unique([
    source.title,
    source.label,
    source.sourceUrl,
    offer.sourceUrl,
    offer.rawFacts?.sourceMetadata?.label,
    offer.rawFacts?.sourceMetadata?.sourceUrl,
    ...rawDocuments.flatMap((doc) => [
      doc.title,
      doc.url,
      doc.canonicalUrl,
      doc.finalUrl,
      doc.payload?.observedUrl,
      doc.payload?.publicationId,
      doc.payload?.revisionId,
    ]),
  ].map(stringifySignal));
}

function collectRawDocumentSignals(rawDocuments = []) {
  return unique(rawDocuments.flatMap((doc) => [
    doc.title,
    doc.url,
    doc.canonicalUrl,
    doc.finalUrl,
    doc.contentSnippet,
    doc.payload?.validTo,
    doc.payload?.validFrom,
    doc.payload?.detectedValidity,
    doc.payload?.detectedValidity?.validFrom,
    doc.payload?.detectedValidity?.validTo,
    doc.payload?.detectedValidity?.detectedDates,
    ...(Array.isArray(doc.extractedPreview) ? doc.extractedPreview.slice(0, 5) : []),
  ]).map(stringifySignal));
}

function collectUnsafeTimeSignals({ offer = {}, source = {}, rawDocuments = [] } = {}) {
  const rawFacts = offer.rawFacts || {};
  return unique([
    offer.fetchedAt,
    offer.observedAt,
    offer.checkedAt,
    offer.createdAt,
    offer.updatedAt,
    offer.firstSeenAt,
    offer.lastSeenAt,
    rawFacts.fetchedAt,
    rawFacts.observedAt,
    rawFacts.checkedAt,
    rawFacts.createdAt,
    rawFacts.updatedAt,
    rawFacts.sourceMetadata?.fetchedAt,
    rawFacts.sourceMetadata?.observedAt,
    rawFacts.sourceMetadata?.checkedAt,
    source.latestRunAt,
    source.createdAt,
    source.updatedAt,
    ...rawDocuments.flatMap((doc) => [
      doc.fetchedAt,
      doc.createdAt,
      doc.updatedAt,
      doc.payload?.fetchedAt,
      doc.payload?.observedAt,
      doc.payload?.checkedAt,
    ]),
  ].map(stringifySignal));
}

function hasValidityKeyword(text = '') {
  return /\b(?:gueltig|gültig|valid|validity|von|ab|bis|angebot|aktion|flugblatt|flyer|prospekt)\b/i.test(String(text));
}

function countDateTokens(text = '') {
  const value = String(text || '');
  const isoDates = value.match(/\b20\d{2}-\d{2}-\d{2}\b/g) || [];
  const dotDates = value.match(/\b\d{1,2}\.\d{1,2}\.(?:20\d{2})?\b/g) || [];
  const urlDates = value.match(/\b\d{2}-\d{2}-20\d{2}\b/g) || [];
  return isoDates.length + dotDates.length + urlDates.length;
}

function hasCalendarWeekOnly(text = '') {
  return /\b(?:kw|kalenderwoche|week)\s*-?\s*\d{1,2}\b/i.test(String(text || '')) && countDateTokens(text) === 0;
}

function hasCurrentFlyerOnly(text = '') {
  return /\b(?:aktuelles?|jetzt|neu(?:es)?)\s+(?:flugblatt|flyer|prospekt)\b/i.test(String(text || '')) && countDateTokens(text) === 0;
}

function hasExplicitValidityPhrase(text = '') {
  return /\b(?:gueltig|gültig|valid|validity|validFrom|validTo|validityText|validityLabel|offerStartDate|offerEndDate|von|ab|bis)\b/i.test(String(text || ''));
}

function hasSafeDateString(text = '') {
  const value = String(text || '');
  if (!value.trim()) return false;
  if (/\b20\d{2}-\d{2}-\d{2}\b/.test(value)) return true;
  if (hasExplicitValidityPhrase(value) && countDateTokens(value) >= 1) return true;
  return /\b\d{1,2}\.\d{1,2}\.?\s*(?:bis|-|–)\s*(?:[a-z]{2}\s*)?\d{1,2}\.\d{1,2}\.(?:20\d{2})\b/i.test(value)
    || /\b\d{2}-\d{2}-20\d{2}-\d{2}-\d{2}-20\d{2}\b/.test(value);
}

function hasSafeDateRange(text = '') {
  const value = String(text || '');
  return countDateTokens(value) >= 2
    || /\b\d{1,2}\.\d{1,2}\.?\s*(?:bis|-|–)\s*(?:[a-z]{2}\s*)?\d{1,2}\.\d{1,2}\.(?:20\d{2})\b/i.test(value)
    || /\b\d{2}-\d{2}-20\d{2}-\d{2}-\d{2}-20\d{2}\b/.test(value);
}

function hasUrlDateHint(text = '') {
  const value = String(text || '');
  return /^https?:\/\//i.test(value)
    && (countDateTokens(value) > 0 || hasCalendarWeekOnly(value) || /(?:kw|woche|week)[-_]?\d{1,2}/i.test(value));
}

function extractRecoveredValidity(text = '') {
  const value = String(text || '');
  const isoDates = value.match(/\b20\d{2}-\d{2}-\d{2}\b/g) || [];
  if (isoDates.length >= 2) return { validFrom: isoDates[0], validTo: isoDates[1], sourceText: truncate(value) };

  const dotDates = value.match(/\b\d{1,2}\.\d{1,2}\.(?:20\d{2})?\b/g) || [];
  if (dotDates.length >= 2) return { validFrom: dotDates[0], validTo: dotDates[1], sourceText: truncate(value) };
  if (isoDates.length === 1 || dotDates.length === 1) {
    return { validFrom: '', validTo: isoDates[0] || dotDates[0], sourceText: truncate(value) };
  }
  return null;
}

function classifyValidityRecovery({ offer = {}, source = {}, rawDocuments = [] } = {}) {
  if (dateKey(offer.validFrom) || dateKey(offer.validTo)) {
    return {
      status: 'already_safe',
      safety: 'safe',
      reason: 'Offer has validFrom and/or validTo already stored.',
      evidence: [dateKey(offer.validFrom), dateKey(offer.validTo)].filter(Boolean),
      recoveredValidity: { validFrom: dateKey(offer.validFrom), validTo: dateKey(offer.validTo) },
    };
  }

  const safeLabel = collectValidityLabels(offer)
    .find((text) => hasExplicitValidityPhrase(text) && hasSafeDateString(text));
  if (safeLabel) {
    return {
      status: 'safely_recoverable_from_validity_label',
      safety: 'safe',
      reason: 'Offer-level validityLabel/validity text contains explicit calendar date evidence.',
      evidence: [safeLabel],
      recoveredValidity: extractRecoveredValidity(safeLabel),
    };
  }

  const safeRawSignal = collectRawValiditySignals(offer)
    .find((text) => hasSafeDateString(text));
  if (safeRawSignal) {
    return {
      status: 'safely_recoverable_from_explicit_offer_text',
      safety: 'safe',
      reason: 'Offer/rawFacts contains explicit offer-level validity date evidence.',
      evidence: [safeRawSignal],
      recoveredValidity: extractRecoveredValidity(safeRawSignal),
    };
  }

  const sourceContext = collectSourceTitleSignals({ offer, source, rawDocuments }).find((text) =>
    hasUrlDateHint(text)
    || hasCalendarWeekOnly(text)
    || hasCurrentFlyerOnly(text)
    || (hasValidityKeyword(text) && (hasSafeDateRange(text) || countDateTokens(text) > 0))
  );
  if (sourceContext) {
    return {
      status: 'conditional_source_context_only',
      safety: 'conditional',
      reason: 'Date evidence is only source/title/url/flyer context and is not safe as offer validity.',
      evidence: [sourceContext],
      recoveredValidity: extractRecoveredValidity(sourceContext),
    };
  }

  const rawDocumentContext = collectRawDocumentSignals(rawDocuments).find((text) =>
    hasUrlDateHint(text)
    || hasCalendarWeekOnly(text)
    || hasCurrentFlyerOnly(text)
    || (hasValidityKeyword(text) && (hasSafeDateRange(text) || countDateTokens(text) > 0))
  );
  if (rawDocumentContext) {
    return {
      status: 'conditional_source_context_only',
      safety: 'conditional',
      reason: 'RawDocument evidence is source/document-level context and needs explicit offer relation before import.',
      evidence: [rawDocumentContext],
      recoveredValidity: extractRecoveredValidity(rawDocumentContext),
    };
  }

  const unsafeTimeSignals = collectUnsafeTimeSignals({ offer, source, rawDocuments });
  if (unsafeTimeSignals.length > 0) {
    return {
      status: 'unsafe_fetched_or_observed_time',
      safety: 'unsafe',
      reason: 'Only crawl/fetched/observed/checked lifecycle timestamps are available.',
      evidence: unsafeTimeSignals.slice(0, 3),
      recoveredValidity: null,
    };
  }

  return {
    status: 'missing',
    safety: 'unsafe',
    reason: 'No belastbare validity evidence found.',
    evidence: [],
    recoveredValidity: null,
  };
}

function inferRecoverability({ offer = {}, source = {}, rawDocuments = [] } = {}) {
  return classifyValidityRecovery({ offer, source, rawDocuments }).status;
}

function buildOfferPreview(offer = {}, { source = {}, rawDocuments = [], assessment = null } = {}) {
  return {
    id: String(offer._id || ''),
    title: offer.title || '',
    retailerKey: offer.retailerKey || '',
    sourceType: offer.sourceType || '',
    validFrom: dateKey(offer.validFrom),
    validTo: dateKey(offer.validTo),
    validityLabel: collectValidityLabels(offer)[0] || '',
    rawValiditySignals: collectRawValiditySignals(offer).map((value) => truncate(value)).slice(0, 3),
    sourceTitleSignals: collectSourceTitleSignals({ offer, source, rawDocuments }).map((value) => truncate(value)).slice(0, 3),
    rawDocumentSignals: collectRawDocumentSignals(rawDocuments).map((value) => truncate(value)).slice(0, 3),
    recoveryStatus: assessment?.status,
    safety: assessment?.safety,
    evidence: assessment?.evidence?.map((value) => truncate(value)).slice(0, 3) || [],
    recoveredValidity: assessment?.recoveredValidity || null,
  };
}

function buildRawDocumentLookup(rawDocuments = []) {
  const bySourceId = new Map();
  const byRetailerSourceType = new Map();

  for (const doc of rawDocuments) {
    const sourceId = String(doc.sourceId || '');
    if (sourceId) {
      if (!bySourceId.has(sourceId)) bySourceId.set(sourceId, []);
      bySourceId.get(sourceId).push(doc);
    }

    const retailerSourceKey = `${doc.retailerKey || ''}::${doc.sourceType || ''}`;
    if (retailerSourceKey !== '::') {
      if (!byRetailerSourceType.has(retailerSourceKey)) byRetailerSourceType.set(retailerSourceKey, []);
      byRetailerSourceType.get(retailerSourceKey).push(doc);
    }
  }

  return { bySourceId, byRetailerSourceType };
}

function resolveRawDocuments(offer = {}, rawDocumentLookup) {
  const sourceIdDocs = rawDocumentLookup.bySourceId.get(String(offer.sourceId || '')) || [];
  const groupDocs = rawDocumentLookup.byRetailerSourceType.get(`${offer.retailerKey || ''}::${offer.sourceType || ''}`) || [];
  return unique([...sourceIdDocs, ...groupDocs].map((doc) => doc._id ? String(doc._id) : JSON.stringify(doc)))
    .map((id) => [...sourceIdDocs, ...groupDocs].find((doc) => String(doc._id || JSON.stringify(doc)) === id))
    .filter(Boolean)
    .slice(0, 8);
}

function isActiveOffer(offer = {}, now = new Date()) {
  if (offer.isActiveNow || offer.isActiveToday) return true;
  if (offer.status !== 'active') return false;
  return !dateKey(offer.validTo) || new Date(offer.validTo) >= now;
}

function emptyStatusCounts() {
  return Object.fromEntries(RECOVERY_STATUSES.map((status) => [status, 0]));
}

function incrementSample(samples, key, value, max = 5) {
  if (samples[key].length < max) samples[key].push(value);
}

function groupKey(retailerKey, sourceType) {
  return `${retailerKey || 'unknown'}::${sourceType || 'unknown'}`;
}

function buildRecommendedFix(row) {
  const safeCount = row.safelyRecoverableValidityCount;
  const conditionalCount = row.conditionallyRecoverableValidityCount;
  const unsafeCount = row.unsafeValidityHintCount;
  const missingCount = row.noValidityEvidenceCount;
  const example = row.sampleSafeRecoverable[0] || row.sampleConditional[0] || row.sampleUnsafe[0] || row.sampleMissing[0] || {};

  if (safeCount > 0) {
    return {
      sourceType: row.sourceType,
      retailerKey: row.retailerKey,
      fixType: row.statusCounts.safely_recoverable_from_validity_label >= row.statusCounts.safely_recoverable_from_explicit_offer_text
        ? 'map-explicit-validity-label'
        : 'map-explicit-offer-validity-text',
      safety: 'safe',
      expectedAffectedOffers: safeCount,
      exampleBefore: example.evidence?.[0] || example.validityLabel || example.rawValiditySignals?.[0] || '',
      exampleRecoveredValidity: example.recoveredValidity || null,
      reason: 'Stored offer-level evidence has explicit calendar validity and can be mapped without using crawl time or source-only context.',
      nextStep: 'Add a parser/normalizer mapping guarded by tests for explicit offer-level validity only.',
    };
  }

  if (conditionalCount > 0) {
    return {
      sourceType: row.sourceType,
      retailerKey: row.retailerKey,
      fixType: 'prove-source-context-offer-relation-before-mapping',
      safety: 'conditional',
      expectedAffectedOffers: conditionalCount,
      exampleBefore: example.evidence?.[0] || example.sourceTitleSignals?.[0] || example.rawDocumentSignals?.[0] || '',
      exampleRecoveredValidity: example.recoveredValidity || null,
      reason: 'Only source/title/url/flyer context is visible. This is useful evidence but not import-safe offer validity.',
      nextStep: 'Keep read-only; inspect parser relation between each offer and the dated flyer/promotion before any write path.',
    };
  }

  if (unsafeCount > 0) {
    return {
      sourceType: row.sourceType,
      retailerKey: row.retailerKey,
      fixType: 'do-not-map-lifecycle-time',
      safety: 'unsafe',
      expectedAffectedOffers: unsafeCount,
      exampleBefore: example.evidence?.[0] || '',
      exampleRecoveredValidity: null,
      reason: 'Available dates are fetchedAt/observedAt/checkedAt or lifecycle timestamps.',
      nextStep: 'Do not fill validFrom/validTo from these fields; enrich raw parser evidence instead.',
    };
  }

  return {
    sourceType: row.sourceType,
    retailerKey: row.retailerKey,
    fixType: 'no-validity-evidence',
    safety: 'unsafe',
    expectedAffectedOffers: missingCount,
    exampleBefore: '',
    exampleRecoveredValidity: null,
    reason: 'No belastbare validity evidence is currently stored.',
    nextStep: 'Add explicit upstream validity capture before considering a normalizer fix.',
  };
}

function buildValidityCoverageDiagnostic({
  offers = [],
  sources = [],
  rawDocuments = [],
  generatedAt = new Date(),
  targetGroups = TARGET_VALIDITY_GROUPS,
} = {}) {
  const generatedDate = generatedAt instanceof Date ? generatedAt : new Date(generatedAt);
  const sourcesById = new Map(sources.map((source) => [String(source._id || ''), source]));
  const rawDocumentLookup = buildRawDocumentLookup(rawDocuments);
  const groups = new Map();

  for (const target of targetGroups) {
    groups.set(groupKey(target.retailerKey, target.sourceType), {
      retailerKey: target.retailerKey,
      sourceType: target.sourceType,
      configuredDisabled: Boolean(target.disabled),
      offers: [],
    });
  }

  for (const source of sources.filter((item) => item?.retailerKey)) {
    const key = groupKey(source.retailerKey, source.sourceType || 'unknown');
    if (!groups.has(key)) {
      groups.set(key, {
        retailerKey: source.retailerKey,
        sourceType: source.sourceType || 'unknown',
        configuredDisabled: source.enabled === false || source.active === false,
        offers: [],
      });
    }
  }

  for (const offer of offers.filter((item) => item?.retailerKey)) {
    const key = groupKey(offer.retailerKey, offer.sourceType || 'unknown');
    if (!groups.has(key)) {
      groups.set(key, {
        retailerKey: offer.retailerKey,
        sourceType: offer.sourceType || 'unknown',
        configuredDisabled: false,
        offers: [],
      });
    }
    groups.get(key).offers.push(offer);
  }

  const rows = [...groups.values()].map((group) => {
    const groupOffers = group.offers;
    const totalOffers = groupOffers.length;
    const statusCounts = emptyStatusCounts();
    const samples = {
      sampleSafeRecoverable: [],
      sampleConditional: [],
      sampleUnsafe: [],
      sampleMissing: [],
    };
    let activeOffers = 0;
    let offersWithValidFrom = 0;
    let offersWithValidTo = 0;
    let offersWithAnyValidity = 0;
    let offersWithValidityLabel = 0;
    let offersWithSourceTitleDateHint = 0;
    let offersWithUrlDateHint = 0;

    for (const offer of groupOffers) {
      const source = sourcesById.get(String(offer.sourceId || '')) || {};
      const docs = resolveRawDocuments(offer, rawDocumentLookup);
      const assessment = classifyValidityRecovery({ offer, source, rawDocuments: docs });
      statusCounts[assessment.status] = (statusCounts[assessment.status] || 0) + 1;

      const hasFrom = Boolean(dateKey(offer.validFrom));
      const hasTo = Boolean(dateKey(offer.validTo));
      const labels = collectValidityLabels(offer);
      const sourceSignals = collectSourceTitleSignals({ offer, source, rawDocuments: docs });
      const urlSignals = sourceSignals.filter((text) => /^https?:\/\//i.test(text));
      const preview = buildOfferPreview(offer, { source, rawDocuments: docs, assessment });

      if (isActiveOffer(offer, generatedDate)) activeOffers += 1;
      if (hasFrom) offersWithValidFrom += 1;
      if (hasTo) offersWithValidTo += 1;
      if (hasFrom || hasTo) offersWithAnyValidity += 1;
      if (labels.length > 0) offersWithValidityLabel += 1;
      if (sourceSignals.some((text) => !/^https?:\/\//i.test(text) && (countDateTokens(text) > 0 || hasCalendarWeekOnly(text) || hasCurrentFlyerOnly(text)))) {
        offersWithSourceTitleDateHint += 1;
      }
      if (urlSignals.some((text) => countDateTokens(text) > 0 || hasCalendarWeekOnly(text) || hasUrlDateHint(text))) {
        offersWithUrlDateHint += 1;
      }

      if (assessment.status === 'safely_recoverable_from_explicit_offer_text' || assessment.status === 'safely_recoverable_from_validity_label') {
        incrementSample(samples, 'sampleSafeRecoverable', preview);
      } else if (assessment.status === 'conditional_source_context_only') {
        incrementSample(samples, 'sampleConditional', preview);
      } else if (assessment.status === 'unsafe_fetched_or_observed_time') {
        incrementSample(samples, 'sampleUnsafe', preview);
      } else if (assessment.status === 'missing') {
        incrementSample(samples, 'sampleMissing', preview);
      }
    }

    const row = {
      retailerKey: group.retailerKey,
      sourceType: group.sourceType,
      configuredDisabled: group.configuredDisabled,
      totalOffers,
      activeOffers,
      offersWithValidFrom,
      offersWithValidTo,
      offersWithAnyValidity,
      offersWithValidityLabel,
      offersWithSourceTitleDateHint,
      offersWithUrlDateHint,
      safelyRecoverableValidityCount: statusCounts.safely_recoverable_from_explicit_offer_text + statusCounts.safely_recoverable_from_validity_label,
      conditionallyRecoverableValidityCount: statusCounts.conditional_source_context_only,
      unsafeValidityHintCount: statusCounts.unsafe_fetched_or_observed_time,
      noValidityEvidenceCount: statusCounts.missing,
      statusCounts,
      ...samples,
    };

    return {
      ...row,
      validFromPresentPct: pct(offersWithValidFrom, totalOffers),
      validToPresentPct: pct(offersWithValidTo, totalOffers),
      anyValidityPresentPct: pct(offersWithAnyValidity, totalOffers),
      recommendedFix: buildRecommendedFix(row),
    };
  }).sort((left, right) =>
    left.retailerKey.localeCompare(right.retailerKey)
    || left.sourceType.localeCompare(right.sourceType)
  );

  const totalOffersAnalyzed = offers.filter((item) => item?.retailerKey).length;
  const recommendedValidityFixes = rows
    .filter((row) => row.totalOffers > 0 || row.configuredDisabled)
    .map(buildRecommendedFix)
    .sort((left, right) => {
      const safetyOrder = { safe: 0, conditional: 1, unsafe: 2 };
      return safetyOrder[left.safety] - safetyOrder[right.safety]
        || right.expectedAffectedOffers - left.expectedAffectedOffers
        || left.retailerKey.localeCompare(right.retailerKey);
    });
  const safeSmallFixCandidates = recommendedValidityFixes
    .filter((fix) => fix.safety === 'safe' && fix.expectedAffectedOffers > 0);

  return {
    ok: true,
    readOnly: true,
    mutatedCollections: [],
    generatedAt: generatedAt instanceof Date ? generatedAt.toISOString() : generatedAt,
    principle: 'Qualitaet der Daten ist kein Nebenthema - sie IST das Produkt.',
    focusQuestion: 'Wann gilt es?',
    summary: {
      totalOffersAnalyzed,
      retailerSourceTypeGroups: rows.length,
      offersWithAnyValidity: offers.filter((offer) => dateKey(offer.validFrom) || dateKey(offer.validTo)).length,
      safelyRecoverableValidityCount: rows.reduce((sum, row) => sum + row.safelyRecoverableValidityCount, 0),
      conditionallyRecoverableValidityCount: rows.reduce((sum, row) => sum + row.conditionallyRecoverableValidityCount, 0),
      unsafeValidityHintCount: rows.reduce((sum, row) => sum + row.unsafeValidityHintCount, 0),
      noValidityEvidenceCount: rows.reduce((sum, row) => sum + row.noValidityEvidenceCount, 0),
    },
    bestValidityGroups: [...rows]
      .filter((row) => row.totalOffers > 0)
      .sort((left, right) => right.anyValidityPresentPct - left.anyValidityPresentPct || right.totalOffers - left.totalOffers)
      .slice(0, 10),
    weakestValidityGroups: [...rows]
      .filter((row) => row.totalOffers > 0)
      .sort((left, right) => left.anyValidityPresentPct - right.anyValidityPresentPct || right.totalOffers - left.totalOffers)
      .slice(0, 10),
    recommendedValidityFixes,
    safeSmallFixCandidates,
    rows,
  };
}

module.exports = {
  TARGET_VALIDITY_GROUPS,
  buildValidityCoverageDiagnostic,
  classifyValidityRecovery,
  collectRawValiditySignals,
  collectValidityLabels,
  inferRecoverability,
  hasSafeDateString,
  hasSafeDateRange,
};
