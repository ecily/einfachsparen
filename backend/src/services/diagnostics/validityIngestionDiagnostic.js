const TARGET_SOURCE_GROUPS = [
  { retailerKey: 'billa', sourceType: 'billa-official-algolia' },
  { retailerKey: 'billa-plus', sourceType: 'billa-official-algolia' },
  { retailerKey: 'spar', sourceType: 'aktionsfinder-json' },
  { retailerKey: 'billa', sourceType: 'aktionsfinder-json' },
  { retailerKey: 'billa-plus', sourceType: 'aktionsfinder-json' },
  { retailerKey: 'bipa', sourceType: 'aktionsfinder-json' },
  { retailerKey: 'penny', sourceType: 'aktionsfinder-json' },
  { retailerKey: 'lidl', sourceType: 'lidl-official-flyer-api' },
  { retailerKey: 'penny', sourceType: 'penny-official-html' },
];

const VALIDITY_FIELD_PATTERN = /(^|\.)(validFrom|validTo|validityText|validityLabel|validity|startDate|endDate|from|to|dateRange|promotionStart|promotionEnd|campaign|campaignId|flyer|leaflet|leafletHref|offerStartDate|offerEndDate|activeFrom|activeTo|visibleFrom|visibleTo|availability|badges|labels|metadata)$/i;
const FETCHED_AT_PATTERN = /(^|\.)(fetchedAt|latestRunAt|createdAt|updatedAt|firstSeenAt|lastSeenAt|observedAt)$/i;

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

function stringify(value) {
  if (value === null || value === undefined) {
    return '';
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncate(value, maxLength = 180) {
  const text = stringify(value).replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function unique(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function getPathValue(object, path) {
  return String(path || '').split('.').reduce((current, part) => {
    if (current === null || current === undefined) {
      return undefined;
    }

    return current[part];
  }, object);
}

function walkFields(value, prefix = '', output = []) {
  if (value === null || value === undefined) {
    return output;
  }

  if (value instanceof Date || ['string', 'number', 'boolean'].includes(typeof value)) {
    output.push({ path: prefix, value });
    return output;
  }

  if (Array.isArray(value)) {
    value.slice(0, 20).forEach((item, index) => {
      walkFields(item, prefix ? `${prefix}.${index}` : String(index), output);
    });
    return output;
  }

  if (typeof value === 'object') {
    Object.entries(value).forEach(([key, nested]) => {
      walkFields(nested, prefix ? `${prefix}.${key}` : key, output);
    });
  }

  return output;
}

function hasDateToken(value) {
  const text = stringify(value);
  return /\b20\d{2}-\d{2}-\d{2}\b/.test(text)
    || /\b\d{1,2}\.\d{1,2}\.(?:20\d{2})?\b/.test(text)
    || /\b\d{2}-\d{2}-20\d{2}\b/.test(text);
}

function hasDateRange(value) {
  const text = stringify(value);
  const isoDates = text.match(/\b20\d{2}-\d{2}-\d{2}\b/g) || [];
  const dotDates = text.match(/\b\d{1,2}\.\d{1,2}\.(?:20\d{2})?\b/g) || [];
  const urlRange = /\b\d{2}-\d{2}-20\d{2}-\d{2}-\d{2}-20\d{2}\b/.test(text);

  return isoDates.length + dotDates.length >= 2 || urlRange;
}

function isValidityField(path) {
  return VALIDITY_FIELD_PATTERN.test(String(path || '').replace(/\.\d+\./g, '.'));
}

function isFetchedAtField(path) {
  return FETCHED_AT_PATTERN.test(String(path || '').replace(/\.\d+\./g, '.'));
}

function collectFieldSignals(records = [], rootName = '') {
  const signals = [];
  const inspected = new Set();

  for (const record of records.filter(Boolean)) {
    for (const field of walkFields(record)) {
      const path = rootName ? `${rootName}.${field.path}` : field.path;

      if (isValidityField(path)) {
        inspected.add(path);
        signals.push({
          path,
          value: truncate(field.value),
          hasDate: hasDateToken(field.value),
          hasRange: hasDateRange(field.value),
          fetchedAtOnly: false,
        });
      } else if (isFetchedAtField(path)) {
        inspected.add(path);
        signals.push({
          path,
          value: truncate(field.value),
          hasDate: hasDateToken(field.value),
          hasRange: false,
          fetchedAtOnly: true,
        });
      }
    }
  }

  return {
    inspectedFields: [...inspected].sort(),
    signals,
  };
}

function currentValidityCoverage(offers = []) {
  const total = offers.length;
  const validFromPresent = offers.filter((offer) => dateKey(offer.validFrom)).length;
  const validToPresent = offers.filter((offer) => dateKey(offer.validTo)).length;
  const bothPresent = offers.filter((offer) => dateKey(offer.validFrom) && dateKey(offer.validTo)).length;
  const rawValidityPresent = offers.filter((offer) => {
    const rawFacts = offer.rawFacts || {};
    return Boolean(
      rawFacts.validityText
      || rawFacts.validityLabel
      || rawFacts.validity
      || rawFacts.validFrom
      || rawFacts.validTo
    );
  }).length;

  return {
    validFromPresentPct: pct(validFromPresent, total),
    validToPresentPct: pct(validToPresent, total),
    bothValidityPresentPct: pct(bothPresent, total),
    rawValiditySignalsPresentPct: pct(rawValidityPresent, total),
  };
}

function countRawDocumentsForGroup(rawDocuments = [], group) {
  return rawDocuments.filter((doc) =>
    doc?.retailerKey === group.retailerKey
    && (
      doc.sourceType === group.sourceType
      || (group.sourceType === 'billa-official-algolia' && doc.title && /algolia/i.test(doc.title))
      || (group.sourceType === 'aktionsfinder-json' && /aktionsfinder/i.test(`${doc.title || ''} ${doc.url || ''}`))
      || (group.sourceType === 'lidl-official-flyer-api' && /lidl/i.test(`${doc.title || ''} ${doc.payload?.flyers ? 'flyers' : ''}`))
      || (group.sourceType === 'penny-official-html' && /penny/i.test(`${doc.title || ''} ${doc.url || ''}`))
    )
  );
}

function sourceCodeHints(group) {
  if (group.sourceType === 'billa-official-algolia') {
    return {
      productiveFiles: [
        'src/services/crawl/officialSourceCrawler.js',
        'src/services/crawl/rawDocumentStorage.js',
      ],
      rawFactsFields: [
        'objectID',
        'sku',
        'price.regular.tags',
        'price.loyalty.tags',
        'price.regular.promotionText',
        'price.loyalty.promotionText',
        'explicit upstream validity fields only if present in full Algolia hit',
      ],
      offerValidityFields: [
        'validFrom only from explicit Algolia start/active/visible/promotion field',
        'validTo only from explicit Algolia end/active/visible/promotion field',
      ],
      leaveEmptyCases: [
        'current snapshot without explicit end date',
        'crawl/fetched/observed timestamps',
        'generic inPromotion:true without campaign date',
      ],
    };
  }

  if (group.sourceType === 'aktionsfinder-json') {
    return {
      productiveFiles: [
        'src/services/crawl/aktionsfinderCrawler.js',
        'src/services/crawl/offerNormalizer.js',
        'src/services/crawl/rawDocumentStorage.js',
      ],
      rawFactsFields: [
        'validityText',
        'validFrom',
        'validTo',
        'leafletHref',
        'clickoutUrl',
        'sourceSectionTitle',
        'promotion.id',
      ],
      offerValidityFields: [
        'promotion.validFrom when explicit per promotion',
        'promotion.validTo when explicit per promotion',
        'dates parsed from leafletHref only when the href belongs to that exact promotion',
      ],
      leaveEmptyCases: [
        'source page date without a per-offer relation',
        'leaflet/source URL date that cannot be tied to the individual offer',
        'fetchedAt/current snapshot',
      ],
    };
  }

  return {
    productiveFiles: ['src/services/crawl/officialSourceCrawler.js'],
    rawFactsFields: ['validityText', 'validFrom', 'validTo', 'source-specific upstream ids'],
    offerValidityFields: ['validFrom', 'validTo from explicit upstream offer/flyer dates'],
    leaveEmptyCases: ['missing explicit upstream validity'],
  };
}

function inferGroupReason({ group, offers, rawDocuments, sourceSignals, rawSignals, offerSignals }) {
  const coverage = currentValidityCoverage(offers);
  const hasOfferRange = offers.some((offer) => dateKey(offer.validFrom) && dateKey(offer.validTo));
  const hasOfferValiditySignal = offerSignals.some((signal) => !signal.fetchedAtOnly && signal.hasDate);
  const hasRawRange = rawSignals.some((signal) => !signal.fetchedAtOnly && signal.hasRange);
  const hasUrlRange = rawDocuments.some((doc) => hasDateRange(`${doc.url || ''} ${doc.canonicalUrl || ''} ${doc.finalUrl || ''}`));
  const hasSourceRange = sourceSignals.some((signal) => !signal.fetchedAtOnly && signal.hasRange);
  const hasOnlyFetchedAt = [...sourceSignals, ...rawSignals, ...offerSignals].some((signal) => signal.fetchedAtOnly)
    && !hasOfferRange
    && !hasOfferValiditySignal
    && !hasRawRange
    && !hasUrlRange
    && !hasSourceRange;
  const hasSnapshotFromOnly = coverage.validFromPresentPct > 0 && coverage.validToPresentPct === 0;

  if (hasOfferRange) {
    return {
      signalLevel: 'offer',
      recoverability: 'safe',
      whyMissing: coverage.bothValidityPresentPct === 100
        ? 'validFrom/validTo sind bereits pro Angebot vorhanden.'
        : 'Ein Teil der Offers hat bereits sichere pro-Angebot-Gültigkeit; fehlende Eintraege brauchen Parser-/Rohsignalpruefung.',
      recommendedFix: 'Produktiv nur die bereits expliziten pro-Angebot-Felder weiter normalisieren und Regressionstests ergaenzen.',
      riskLevel: 'low',
    };
  }

  if (hasOfferValiditySignal) {
    return {
      signalLevel: 'offer',
      recoverability: 'safe',
      whyMissing: 'Explizite Angebotssignale liegen in rawFacts/Offer-Daten, werden aber nicht durchgaengig in validFrom/validTo gemappt.',
      recommendedFix: 'Produktiv Mapping von expliziten offer-level validFrom/validTo/validityText in Offer.validFrom/validTo ergaenzen.',
      riskLevel: 'low',
    };
  }

  if (group.sourceType === 'billa-official-algolia') {
    const hasNonFetchedRawSignal = rawSignals.some((signal) => !signal.fetchedAtOnly);

    return {
      signalLevel: hasNonFetchedRawSignal ? 'rawDocument' : 'none',
      recoverability: 'not-safe',
      whyMissing: hasSnapshotFromOnly
        ? 'Algolia-Offers werden als aktueller Snapshot gespeichert; validFrom entspricht produktiv einem Crawlzeitpunkt und validTo fehlt. RawDocuments enthalten aktuell nur kompakte Samples/Namen, nicht die vollen Hits mit moeglichen Kampagnenfeldern.'
        : 'In gespeicherten Offers/RawDocuments sind keine sicheren Algolia-Gültigkeitsfelder erkennbar.',
      recommendedFix: 'Zuerst read-only/full-sample Algolia-Hits inspizieren oder RawDocument-Payload um nicht-mutierende Full-Hit-Samples erweitern; erst danach explizite Upstream-Datumsfelder mappen.',
      riskLevel: 'high',
    };
  }

  if (hasRawRange || hasSourceRange || hasUrlRange) {
    const signalLevel = hasUrlRange ? 'url' : hasRawRange ? 'rawDocument' : 'source';

    return {
      signalLevel,
      recoverability: 'conditional',
      whyMissing: 'Datumsrange existiert nicht sicher als Offer-Feld, sondern nur auf Source-/Leaflet-/RawDocument-/URL-Ebene oder nur fuer einen Teil der importierten Promotions.',
      recommendedFix: 'Produktiv nur mappen, wenn die Datumsrange eindeutig an die konkrete Promotion gebunden ist; Source-Level-Ranges sonst nur in rawFacts/evidence speichern.',
      riskLevel: 'medium',
    };
  }

  if (hasOnlyFetchedAt) {
    return {
      signalLevel: 'none',
      recoverability: 'not-safe',
      whyMissing: 'Es gibt nur Crawl-/fetchedAt-/Lifecycle-Zeitpunkte. Diese duerfen nicht als Angebotsgueltigkeit verwendet werden.',
      recommendedFix: 'Keine produktive Befuellung; Upstream muss explizite Gültigkeitsfelder oder eindeutig zugeordnete Leaflet-Hrefs liefern.',
      riskLevel: 'high',
    };
  }

  return {
    signalLevel: 'none',
    recoverability: 'not-safe',
    whyMissing: 'Keine sicheren Gültigkeitssignale in den aktuell gespeicherten Offer-/Source-/RawDocument-Daten gefunden.',
    recommendedFix: 'Keine produktive Befuellung; Parser/Rohspeicherung zuerst um explizite Upstream-Signale erweitern.',
    riskLevel: 'high',
  };
}

function buildSourceRow({ group, offers = [], sources = [], rawDocuments = [] }) {
  const matchingOffers = offers.filter((offer) => offer.retailerKey === group.retailerKey && offer.sourceType === group.sourceType);
  const matchingSources = sources.filter((source) => source.retailerKey === group.retailerKey);
  const matchingRawDocuments = countRawDocumentsForGroup(rawDocuments, group);
  const sourceCollected = collectFieldSignals(matchingSources, 'source');
  const rawCollected = collectFieldSignals(matchingRawDocuments, 'rawDocument');
  const offerCollected = collectFieldSignals(
    matchingOffers.map((offer) => ({
      validFrom: offer.validFrom,
      validTo: offer.validTo,
      sourceUrl: offer.sourceUrl,
      rawFacts: offer.rawFacts || {},
      supportingSources: offer.supportingSources || [],
    })),
    'offer'
  );
  const inferred = inferGroupReason({
    group,
    offers: matchingOffers,
    rawDocuments: matchingRawDocuments,
    sourceSignals: sourceCollected.signals,
    rawSignals: rawCollected.signals,
    offerSignals: offerCollected.signals,
  });
  const discoveredValiditySignals = unique(
    [...offerCollected.signals, ...rawCollected.signals, ...sourceCollected.signals]
      .filter((signal) => !signal.fetchedAtOnly)
      .map((signal) => signal.path)
  );
  const sampleSignals = [...offerCollected.signals, ...rawCollected.signals, ...sourceCollected.signals]
    .filter((signal) => !signal.fetchedAtOnly || !discoveredValiditySignals.length)
    .slice(0, 12)
    .map((signal) => ({
      path: signal.path,
      value: signal.value,
      hasDate: signal.hasDate,
      hasRange: signal.hasRange,
      fetchedAtOnly: signal.fetchedAtOnly,
    }));
  const hints = sourceCodeHints(group);

  return {
    retailerKey: group.retailerKey,
    sourceType: group.sourceType,
    offerCount: matchingOffers.length,
    currentValidityCoverage: currentValidityCoverage(matchingOffers),
    rawDocumentCount: matchingRawDocuments.length,
    inspectedFields: unique([
      ...offerCollected.inspectedFields,
      ...rawCollected.inspectedFields,
      ...sourceCollected.inspectedFields,
    ]).slice(0, 80),
    discoveredValiditySignals,
    sampleSignals,
    signalLevel: inferred.signalLevel,
    recoverability: inferred.recoverability,
    whyMissing: inferred.whyMissing,
    recommendedFix: inferred.recommendedFix,
    riskLevel: inferred.riskLevel,
    codePathHints: hints,
  };
}

function recommendedFirstProductiveFix(rows = []) {
  const safeAktionsfinder = rows.find((row) =>
    row.sourceType === 'aktionsfinder-json'
    && row.recoverability === 'safe'
    && row.currentValidityCoverage.bothValidityPresentPct < 100
  );

  if (safeAktionsfinder) {
    return `Aktionsfinder ${safeAktionsfinder.retailerKey}: explizite offer-level Validity-Signale in validFrom/validTo mappen.`;
  }

  const conditionalAktionsfinder = rows.find((row) =>
    row.sourceType === 'aktionsfinder-json'
    && row.recoverability === 'conditional'
  );

  if (conditionalAktionsfinder) {
    return `Aktionsfinder ${conditionalAktionsfinder.retailerKey}: zuerst leafletHref/clickoutUrl pro Promotion in rawFacts speichern und nur eindeutig promotion-gebundene Datumsranges mappen.`;
  }

  const reference = rows.find((row) => row.recoverability === 'safe');

  if (reference) {
    return `${reference.sourceType} als Referenz absichern; fuer schwache Quellen erst Rohsignale erweitern, nicht spekulativ mappen.`;
  }

  return 'Noch kein produktiver Validity-Fix verantwortbar; zuerst RawDocument/rawFacts um explizite Upstream-Signale erweitern.';
}

function buildValidityIngestionDiagnostic({
  offers = [],
  sources = [],
  rawDocuments = [],
  generatedAt = new Date(),
  targetGroups = TARGET_SOURCE_GROUPS,
} = {}) {
  const rows = targetGroups.map((group) => buildSourceRow({
    group,
    offers,
    sources,
    rawDocuments,
  }));
  const sourceTypesAnalyzed = unique(rows.map((row) => `${row.retailerKey}/${row.sourceType}`));
  const likelyRecoverableSourceTypes = rows
    .filter((row) => row.recoverability === 'safe' || row.recoverability === 'conditional')
    .map((row) => `${row.retailerKey}/${row.sourceType}`);
  const notSafelyRecoverableSourceTypes = rows
    .filter((row) => row.recoverability === 'not-safe')
    .map((row) => `${row.retailerKey}/${row.sourceType}`);

  return {
    ok: true,
    readOnly: true,
    mutatedCollections: [],
    generatedAt: generatedAt instanceof Date ? generatedAt.toISOString() : generatedAt,
    principle: 'Qualitaet der Daten ist kein Nebenthema - sie IST das Produkt.',
    focusQuestion: 'Wann gilt es?',
    summary: {
      sourceTypesAnalyzed,
      likelyRecoverableSourceTypes,
      notSafelyRecoverableSourceTypes,
      recommendedFirstProductiveFix: recommendedFirstProductiveFix(rows),
    },
    sources: rows,
  };
}

module.exports = {
  TARGET_SOURCE_GROUPS,
  buildValidityIngestionDiagnostic,
  currentValidityCoverage,
  inferGroupReason,
  recommendedFirstProductiveFix,
};
