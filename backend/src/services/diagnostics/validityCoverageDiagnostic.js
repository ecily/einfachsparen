function dateKey(value) {
  if (!value) {
    return '';
  }

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
  if (!value) {
    return '';
  }

  if (value instanceof Date) {
    return dateKey(value);
  }

  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }

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

function hasSafeDateString(text = '') {
  const value = String(text || '');

  if (!value.trim()) {
    return false;
  }

  if (/\b20\d{2}-\d{2}-\d{2}\b/.test(value)) {
    return true;
  }

  if (/(?:gueltig|gültig|von|ab|bis|valid|offerStartDate|offerEndDate)/i.test(value) && countDateTokens(value) >= 1) {
    return true;
  }

  return /\b\d{1,2}\.\d{1,2}\.?\s*(?:bis|-|–)\s*(?:[a-z]{2}\s*)?\d{1,2}\.\d{1,2}\.(?:20\d{2})\b/i.test(value)
    || /\b\d{2}-\d{2}-20\d{2}-\d{2}-\d{2}-20\d{2}\b/.test(value);
}

function hasSafeDateRange(text = '') {
  const value = String(text || '');
  return countDateTokens(value) >= 2
    || /\b\d{1,2}\.\d{1,2}\.?\s*(?:bis|-|–)\s*(?:[a-z]{2}\s*)?\d{1,2}\.\d{1,2}\.(?:20\d{2})\b/i.test(value)
    || /\b\d{2}-\d{2}-20\d{2}-\d{2}-\d{2}-20\d{2}\b/.test(value);
}

function inferRecoverability({ offer = {}, source = {}, rawDocuments = [] } = {}) {
  if (dateKey(offer.validFrom) && dateKey(offer.validTo)) {
    return 'already-present';
  }

  const validityLabels = collectValidityLabels(offer);
  if (validityLabels.some((text) => hasValidityKeyword(text) && hasSafeDateString(text))) {
    return 'recoverable-from-validityLabel';
  }

  const rawSignals = collectRawValiditySignals(offer);
  if (rawSignals.some(hasSafeDateString)) {
    return 'recoverable-from-rawFacts';
  }

  const sourceTitleSignals = collectSourceTitleSignals({ offer, source, rawDocuments });
  if (sourceTitleSignals.some((text) => hasValidityKeyword(text) && hasSafeDateRange(text))) {
    return 'recoverable-from-source-title';
  }

  const rawDocumentSignals = collectRawDocumentSignals(rawDocuments);
  if (rawDocumentSignals.some((text) => hasValidityKeyword(text) && hasSafeDateString(text))) {
    return 'recoverable-from-rawDocument';
  }

  return 'not-safely-recoverable';
}

function buildOfferPreview(offer = {}, { source = {}, rawDocuments = [] } = {}) {
  const sourceTitleSignals = collectSourceTitleSignals({ offer, source, rawDocuments })
    .map((value) => truncate(value))
    .slice(0, 3);
  const rawDocumentSignals = collectRawDocumentSignals(rawDocuments)
    .map((value) => truncate(value))
    .slice(0, 3);

  return {
    id: String(offer._id || ''),
    title: offer.title || '',
    retailerKey: offer.retailerKey || '',
    sourceType: offer.sourceType || '',
    validFrom: dateKey(offer.validFrom),
    validTo: dateKey(offer.validTo),
    validityLabel: collectValidityLabels(offer)[0] || '',
    rawValiditySignals: collectRawValiditySignals(offer).map((value) => truncate(value)).slice(0, 3),
    sourceTitleSignals,
    rawDocumentSignals,
  };
}

function recommendedFixFor(statusCounts = {}, group = {}) {
  const total = group.offerCount || 0;
  const already = pct(statusCounts['already-present'] || 0, total);
  const label = pct(statusCounts['recoverable-from-validityLabel'] || 0, total);
  const rawFacts = pct(statusCounts['recoverable-from-rawFacts'] || 0, total);
  const sourceTitle = pct(statusCounts['recoverable-from-source-title'] || 0, total);
  const rawDocument = pct(statusCounts['recoverable-from-rawDocument'] || 0, total);

  if (already >= 80) {
    return 'ValidFrom/validTo sind bereits weitgehend vorhanden; Parser nur auf Ausreisser und Regressionen pruefen.';
  }

  if (label >= 20) {
    return 'Produktiv zuerst parsernahe Validity-Normalisierung aus validityLabel/rawFacts.validityText ergaenzen und nur bei eindeutigen Datumsstrings schreiben.';
  }

  if (rawFacts >= 20) {
    return 'Produktiv rawFacts-validity Felder normalisieren; vorhandene strukturierte Rohsignale sind die sicherste Quelle.';
  }

  if (sourceTitle >= 20) {
    return 'Produktiv Source-/Flyer-Titel oder URL-Datumsrange pro SourceType als globales Angebotsfenster ableiten.';
  }

  if (rawDocument >= 20) {
    return 'Produktiv RawDocument-Payload/Titel als Fallback lesen; nur einsetzen, wenn eine eindeutige Range pro Dokument existiert.';
  }

  return 'Nicht produktiv befuellen: aktuell fehlen ausreichend sichere Datumssignale. Erst Parser/Rohdokumente mit expliziten Validity-Feldern anreichern.';
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

function buildValidityCoverageDiagnostic({
  offers = [],
  sources = [],
  rawDocuments = [],
  generatedAt = new Date(),
} = {}) {
  const sourcesById = new Map(sources.map((source) => [String(source._id || ''), source]));
  const rawDocumentLookup = buildRawDocumentLookup(rawDocuments);
  const groups = new Map();

  for (const offer of offers.filter((item) => item?.retailerKey)) {
    const key = `${offer.retailerKey || 'unknown'}::${offer.sourceType || 'unknown'}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key).push(offer);
  }

  const rows = [...groups.entries()].map(([key, groupOffers]) => {
    const [retailerKey, sourceType] = key.split('::');
    const offerCount = groupOffers.length;
    const statusCounts = {};
    const missing = [];
    const availableSignals = [];
    const validityLabels = [];
    const metadataCounts = {
      sourceFetchedAt: 0,
      sourceValidFrom: 0,
      sourceValidTo: 0,
      sourceTitle: 0,
      rawDocumentFetchedAt: 0,
      rawDocumentTitle: 0,
      rawDocumentUrl: 0,
      parserVersion: 0,
      sourceKey: 0,
      sourceType: 0,
    };

    let validFromPresent = 0;
    let validToPresent = 0;
    let bothPresent = 0;
    let labelPresent = 0;
    let rawSignalsPresent = 0;

    for (const offer of groupOffers) {
      const source = sourcesById.get(String(offer.sourceId || '')) || {};
      const docs = resolveRawDocuments(offer, rawDocumentLookup);
      const recoverability = inferRecoverability({ offer, source, rawDocuments: docs });
      statusCounts[recoverability] = (statusCounts[recoverability] || 0) + 1;

      const hasFrom = Boolean(dateKey(offer.validFrom));
      const hasTo = Boolean(dateKey(offer.validTo));
      const labels = collectValidityLabels(offer);
      const rawSignals = collectRawValiditySignals(offer);

      if (hasFrom) validFromPresent += 1;
      if (hasTo) validToPresent += 1;
      if (hasFrom && hasTo) bothPresent += 1;
      if (labels.length > 0) labelPresent += 1;
      if (rawSignals.length > 0) rawSignalsPresent += 1;

      if (labels.length > 0) {
        validityLabels.push(...labels.map((value) => truncate(value)));
      }

      if (!hasFrom || !hasTo) {
        missing.push(buildOfferPreview(offer, { source, rawDocuments: docs }));
      }

      if (recoverability !== 'not-safely-recoverable') {
        availableSignals.push({
          recovery: recoverability,
          ...buildOfferPreview(offer, { source, rawDocuments: docs }),
        });
      }

      if (source.latestRunAt || source.updatedAt || source.createdAt) metadataCounts.sourceFetchedAt += 1;
      if (source.validFrom) metadataCounts.sourceValidFrom += 1;
      if (source.validTo) metadataCounts.sourceValidTo += 1;
      if (source.title || source.label) metadataCounts.sourceTitle += 1;
      if (docs.some((doc) => doc.fetchedAt)) metadataCounts.rawDocumentFetchedAt += 1;
      if (docs.some((doc) => doc.title)) metadataCounts.rawDocumentTitle += 1;
      if (docs.some((doc) => doc.url || doc.canonicalUrl || doc.finalUrl)) metadataCounts.rawDocumentUrl += 1;
      if (offer.parserVersion || offer.rawFacts?.parserVersion || source.parserVersion || docs.some((doc) => doc.parserVersion || doc.payload?.parserVersion)) metadataCounts.parserVersion += 1;
      if (offer.sourceKey || offer.rawFacts?.sourceKey || offer.rawFacts?.sourceMetadata?.sourceKey || docs.some((doc) => doc.payload?.sourceKey)) metadataCounts.sourceKey += 1;
      if (offer.sourceType || offer.rawFacts?.sourceType || source.sourceType || docs.some((doc) => doc.sourceType || doc.payload?.sourceType)) metadataCounts.sourceType += 1;
    }

    const likelyRecoverable = Object.entries(statusCounts)
      .sort((left, right) => right[1] - left[1])
      .map(([status, count]) => ({ status, count, percent: pct(count, offerCount) }));

    return {
      retailerKey,
      sourceType,
      offerCount,
      validFromPresentPct: pct(validFromPresent, offerCount),
      validToPresentPct: pct(validToPresent, offerCount),
      bothValidityPresentPct: pct(bothPresent, offerCount),
      validityLabelPresentPct: pct(labelPresent, offerCount),
      rawValiditySignalsPresentPct: pct(rawSignalsPresent, offerCount),
      metadataCoverage: Object.fromEntries(Object.entries(metadataCounts).map(([field, count]) => [field, pct(count, offerCount)])),
      sampleValidityLabels: unique(validityLabels).slice(0, 8),
      sampleMissingValidityOffers: missing.slice(0, 5),
      sampleAvailableValiditySignals: availableSignals.slice(0, 5),
      likelyRecoverable,
      recommendedFix: recommendedFixFor(statusCounts, { offerCount }),
    };
  }).sort((left, right) =>
    left.retailerKey.localeCompare(right.retailerKey)
    || left.sourceType.localeCompare(right.sourceType)
  );

  const totalOffers = offers.filter((item) => item?.retailerKey).length;
  const topPoorCoverage = [...rows]
    .filter((row) => row.offerCount > 0)
    .sort((left, right) => left.bothValidityPresentPct - right.bothValidityPresentPct || right.offerCount - left.offerCount)
    .slice(0, 10);
  const topRecoverable = [...rows]
    .map((row) => {
      const recoverablePct = row.likelyRecoverable
        .filter((item) => item.status !== 'already-present' && item.status !== 'not-safely-recoverable')
        .reduce((sum, item) => sum + item.percent, 0);
      return { ...row, recoverableMissingPct: Number(recoverablePct.toFixed(1)) };
    })
    .filter((row) => row.recoverableMissingPct > 0)
    .sort((left, right) => right.recoverableMissingPct - left.recoverableMissingPct || right.offerCount - left.offerCount)
    .slice(0, 10);

  return {
    ok: true,
    readOnly: true,
    mutatedCollections: [],
    generatedAt: generatedAt instanceof Date ? generatedAt.toISOString() : generatedAt,
    principle: 'Qualitaet der Daten ist kein Nebenthema - sie IST das Produkt.',
    summary: {
      totalOffersAnalyzed: totalOffers,
      retailerSourceTypeGroups: rows.length,
      bothValidityPresentPct: pct(offers.filter((offer) => dateKey(offer.validFrom) && dateKey(offer.validTo)).length, totalOffers),
      validityLabelPresentPct: pct(offers.filter((offer) => collectValidityLabels(offer).length > 0).length, totalOffers),
      rawValiditySignalsPresentPct: pct(offers.filter((offer) => collectRawValiditySignals(offer).length > 0).length, totalOffers),
    },
    topPoorCoverage,
    topRecoverable,
    rows,
  };
}

module.exports = {
  buildValidityCoverageDiagnostic,
  collectRawValiditySignals,
  collectValidityLabels,
  inferRecoverability,
  hasSafeDateString,
  hasSafeDateRange,
};
