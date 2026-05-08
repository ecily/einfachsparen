const fs = require('node:fs');
const path = require('node:path');
const { RETAILER_DEFINITIONS } = require('../sources/sourceDefinitions');

const TARGET_RETAILERS = [
  { retailerKey: 'penny', retailerName: 'PENNY' },
  { retailerKey: 'billa', retailerName: 'BILLA' },
  { retailerKey: 'billa-plus', retailerName: 'BILLA PLUS' },
  { retailerKey: 'spar', retailerName: 'SPAR / INTERSPAR / EUROSPAR' },
  { retailerKey: 'lidl', retailerName: 'LIDL' },
  { retailerKey: 'hofer', retailerName: 'HOFER' },
  { retailerKey: 'dm', retailerName: 'dm' },
  { retailerKey: 'bipa', retailerName: 'BIPA' },
];

const EXTRACTION_RANK = {
  'structured-json': 1,
  'official-html': 2,
  'aggregator-json': 3,
  'viewer-metadata': 4,
  'pdf-textlayer': 5,
  'ocr-bbox': 6,
  unknown: 99,
};

const SOURCE_CONFIDENCE = {
  'structured-json': 0.94,
  'official-html': 0.86,
  'aggregator-json': 0.78,
  'viewer-metadata': 0.58,
  'pdf-textlayer': 0.52,
  'ocr-bbox': 0.28,
  unknown: 0.2,
};

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function byRetailer(items = []) {
  const grouped = new Map();

  for (const item of items) {
    const key = String(item.retailerKey || item._id?.retailerKey || '');

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

function inferDefinitionSourceType(definition = {}) {
  if (definition.sourceType) {
    return definition.sourceType;
  }

  if (definition.channel === 'official-site') {
    return 'offers-page';
  }

  if (definition.channel === 'official-flyer') {
    return 'flyer';
  }

  if (definition.channel === 'aggregator') {
    return 'aggregator';
  }

  return 'other';
}

function inferExtractionMethod({ sourceType = '', channel = '', documentType = '', parserHint = '', url = '' } = {}) {
  const haystack = `${sourceType} ${channel} ${documentType} ${parserHint} ${url}`.toLowerCase();

  if (/(ocr|bbox|paddle|tesseract)/.test(haystack)) {
    return 'ocr-bbox';
  }

  if (/(issuu|viewer|image-flyer)/.test(haystack)) {
    return 'viewer-metadata';
  }

  if (documentType === 'pdf' || /\bpdf\b|official-pdf/.test(haystack)) {
    return 'pdf-textlayer';
  }

  if (
    /(official.*(?:json|api|algolia)|(?:json|api|algolia).*official|lidl-official-flyer-api|billa-official-algolia)/.test(haystack)
  ) {
    return 'structured-json';
  }

  if (channel === 'official-site' || /official-html|official-site|offers-page/.test(haystack)) {
    return 'official-html';
  }

  if (/(aktionsfinder-json|marketguru-json|marketguru-embedded-json|aggregator|wogibtswas)/.test(haystack)) {
    return 'aggregator-json';
  }

  if (documentType === 'json' || /\bjson\b|\bapi\b|algolia/.test(haystack)) {
    return 'structured-json';
  }

  return 'unknown';
}

function roleForMethod(method) {
  if (['structured-json', 'official-html'].includes(method)) {
    return 'primary';
  }

  if (['aggregator-json', 'viewer-metadata', 'pdf-textlayer'].includes(method)) {
    return 'supplemental';
  }

  return 'fallback';
}

function buildSourceEvidenceEntries({ definitions = [], sources = [], offerRows = [], rawRows = [] } = {}) {
  const entries = [];

  for (const definition of definitions) {
    const sourceType = inferDefinitionSourceType(definition);
    const extractionMethod = inferExtractionMethod({
      sourceType,
      channel: definition.channel,
      parserHint: definition.parserHint,
      url: definition.sourceUrl,
    });

    entries.push({
      retailerKey: definition.retailerKey,
      sourceType,
      channel: definition.channel,
      label: definition.label,
      sourceUrl: definition.sourceUrl,
      enabled: definition.enabled !== false,
      latestStatus: definition.latestStatus || '',
      extractionMethod,
      sourceConfidence: SOURCE_CONFIDENCE[extractionMethod] ?? SOURCE_CONFIDENCE.unknown,
      recommendedRole: roleForMethod(extractionMethod),
      origin: 'definition',
    });
  }

  for (const source of sources) {
    const extractionMethod = inferExtractionMethod({
      sourceType: source.sourceType,
      channel: source.channel,
      parserHint: source.parserHint,
      url: source.sourceUrl,
    });

    entries.push({
      retailerKey: source.retailerKey,
      sourceType: source.sourceType || inferDefinitionSourceType(source),
      channel: source.channel || '',
      label: source.label || '',
      sourceUrl: source.sourceUrl || '',
      enabled: source.enabled !== false,
      latestStatus: source.latestStatus || '',
      extractionMethod,
      sourceConfidence: SOURCE_CONFIDENCE[extractionMethod] ?? SOURCE_CONFIDENCE.unknown,
      recommendedRole: roleForMethod(extractionMethod),
      origin: 'db-source',
    });
  }

  for (const row of offerRows) {
    const sourceType = row.sourceType || row._id?.sourceType || 'unknown';
    const extractionMethod = inferExtractionMethod({ sourceType });

    entries.push({
      retailerKey: row.retailerKey || row._id?.retailerKey,
      sourceType,
      channel: '',
      label: '',
      sourceUrl: '',
      enabled: true,
      latestStatus: '',
      extractionMethod,
      sourceConfidence: Number(row.avgSourceConfidence || 0) || SOURCE_CONFIDENCE[extractionMethod] || SOURCE_CONFIDENCE.unknown,
      recommendedRole: roleForMethod(extractionMethod),
      origin: 'offer-aggregate',
    });
  }

  for (const row of rawRows) {
    const sourceType = row.sourceType || row._id?.sourceType || 'unknown';
    const documentType = row.documentType || row._id?.documentType || '';
    const extractionMethod = inferExtractionMethod({ sourceType, documentType });

    entries.push({
      retailerKey: row.retailerKey || row._id?.retailerKey,
      sourceType,
      channel: '',
      label: '',
      sourceUrl: '',
      enabled: true,
      latestStatus: '',
      extractionMethod,
      sourceConfidence: SOURCE_CONFIDENCE[extractionMethod] ?? SOURCE_CONFIDENCE.unknown,
      recommendedRole: roleForMethod(extractionMethod),
      origin: 'raw-document-aggregate',
    });
  }

  return entries.filter((entry) => entry.retailerKey);
}

function mapOfferCounts(rows = []) {
  const counts = {};

  for (const row of rows) {
    const sourceType = row.sourceType || row._id?.sourceType || 'unknown';
    counts[sourceType] = {
      offers: Number(row.offers || row.count || 0),
      activeNow: Number(row.activeNow || 0),
    };
  }

  return counts;
}

function pickPrimarySource(entries = [], offerCounts = {}) {
  const activeMethods = entries
    .map((entry) => {
      const counts = offerCounts[entry.sourceType] || {};
      const activeNow = Number(counts.activeNow || 0);
      const offers = Number(counts.offers || 0);
      const hasObservedData = activeNow > 0 || offers > 0 || entry.origin === 'db-source';

      return {
        ...entry,
        activeNow,
        offers,
        hasObservedData,
      };
    })
    .filter((entry) => entry.enabled !== false)
    .sort((left, right) => {
      const leftRank = EXTRACTION_RANK[left.extractionMethod] ?? EXTRACTION_RANK.unknown;
      const rightRank = EXTRACTION_RANK[right.extractionMethod] ?? EXTRACTION_RANK.unknown;

      if (left.hasObservedData !== right.hasObservedData) {
        return left.hasObservedData ? -1 : 1;
      }

      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }

      if (left.activeNow !== right.activeNow) {
        return right.activeNow - left.activeNow;
      }

      if (left.offers !== right.offers) {
        return right.offers - left.offers;
      }

      return (right.sourceConfidence || 0) - (left.sourceConfidence || 0);
    });

  return activeMethods[0] || null;
}

function sourceSummary(entry = {}) {
  if (!entry) {
    return null;
  }

  return {
    sourceType: entry.sourceType || 'unknown',
    extractionMethod: entry.extractionMethod || 'unknown',
    sourceConfidence: Number((entry.sourceConfidence || 0).toFixed(2)),
    role: entry.recommendedRole || roleForMethod(entry.extractionMethod),
    label: entry.label || '',
    sourceUrl: entry.sourceUrl || '',
  };
}

function hasMethod(entries, method) {
  return entries.some((entry) => entry.extractionMethod === method && entry.enabled !== false);
}

function buildRetailerRisks({ entries = [], offerCounts = {}, rawRows = [], duplicateRows = [] } = {}) {
  const risks = [];
  const activeSourceTypes = Object.entries(offerCounts)
    .filter(([, counts]) => Number(counts.activeNow || counts.offers || 0) > 0)
    .map(([sourceType]) => sourceType);

  if (activeSourceTypes.length > 1) {
    risks.push('Mehrere aktive SourceTypes: Dubletten- und Konfliktrisiko pruefen.');
  }

  if (duplicateRows.some((row) => Number(row.groups || row.duplicateGroups || row.count || 0) > 0)) {
    risks.push('Aggregierte Duplicate-Signale vorhanden.');
  }

  if (!entries.some((entry) => ['structured-json', 'official-html'].includes(entry.extractionMethod) && entry.enabled !== false)) {
    risks.push('Keine belastbare offizielle digitale Primaerquelle erkennbar.');
  }

  if (rawRows.some((row) => (row.documentType || row._id?.documentType) === 'pdf')) {
    risks.push('PDF-/Flyer-Daten koennen Layout- und Gueltigkeitsartefakte enthalten.');
  }

  if (entries.some((entry) => entry.extractionMethod === 'ocr-bbox')) {
    risks.push('OCR-Daten duerfen nur als Evidence/Fallback verwendet werden.');
  }

  return risks;
}

function buildNextActions({ primary, entries = [], offerCounts = {} } = {}) {
  const actions = [];

  if (!primary) {
    actions.push('SourceRegistry/Definition fuer diesen Haendler klaeren.');
    return actions;
  }

  if (primary.extractionMethod === 'structured-json') {
    actions.push('Strukturierte Quelle als Primaerpfad absichern und Feldvollstaendigkeit messen.');
  } else if (primary.extractionMethod === 'official-html') {
    actions.push('Offizielle HTML-Extraktion stabilisieren und gegen Aggregator-Daten querpruefen.');
  } else if (primary.extractionMethod === 'aggregator-json') {
    actions.push('Aggregator als Zwischen-Primaerquelle nutzen, offizielle strukturierte Quelle weiter suchen.');
  } else if (primary.extractionMethod === 'pdf-textlayer') {
    actions.push('PDF nur supplemental/fallback verwenden und Textlayer-Qualitaet separat messen.');
  } else {
    actions.push('Keine produktive OCR-Empfehlung; bessere digitale Quelle priorisieren.');
  }

  if (Object.keys(offerCounts).length > 1) {
    actions.push('Cross-Source-Dedupe und Source-Prioritaet vor Launch explizit pruefen.');
  }

  if (!hasMethod(entries, 'structured-json')) {
    actions.push('Nach API-nahen JSON-/Hydration-Daten suchen, bevor OCR ausgebaut wird.');
  }

  return uniq(actions).slice(0, 4);
}

function determineOcrRole(entries = [], primary = null) {
  const hasOcr = hasMethod(entries, 'ocr-bbox');

  if (primary && ['structured-json', 'official-html', 'aggregator-json'].includes(primary.extractionMethod)) {
    return hasOcr ? 'diagnostic-only' : 'none';
  }

  if (primary && ['viewer-metadata', 'pdf-textlayer'].includes(primary.extractionMethod)) {
    return 'fallback-only';
  }

  return hasOcr ? 'candidate-for-later' : 'fallback-only';
}

function mapRawDocumentCounts(rows = []) {
  return rows.map((row) => ({
    sourceType: row.sourceType || row._id?.sourceType || 'unknown',
    documentType: row.documentType || row._id?.documentType || 'unknown',
    documents: Number(row.documents || 0),
    parsedOffers: Number(row.parsedOffers || 0),
  }));
}

function buildRetailerAudit({
  retailer,
  definitions = [],
  sources = [],
  offerRows = [],
  rawRows = [],
  duplicateRows = [],
} = {}) {
  const entries = buildSourceEvidenceEntries({ definitions, sources, offerRows, rawRows });
  const offerCountsBySourceType = mapOfferCounts(offerRows);
  const activeNowBySourceType = Object.fromEntries(
    Object.entries(offerCountsBySourceType).map(([sourceType, counts]) => [sourceType, counts.activeNow])
  );
  const primary = pickPrimarySource(entries, offerCountsBySourceType);
  const supplemental = entries
    .filter((entry) => entry !== primary)
    .filter((entry) => entry.enabled !== false)
    .filter((entry) => entry.recommendedRole !== 'fallback')
    .sort((left, right) => (EXTRACTION_RANK[left.extractionMethod] ?? 99) - (EXTRACTION_RANK[right.extractionMethod] ?? 99))
    .map(sourceSummary);

  return {
    retailerKey: retailer.retailerKey,
    retailerName: retailer.retailerName,
    existingSourceTypes: uniq(entries.map((entry) => entry.sourceType)).sort(),
    sourceDiagnostics: uniq(entries.map((entry) => JSON.stringify(sourceSummary(entry))))
      .map((value) => JSON.parse(value))
      .sort((left, right) => (EXTRACTION_RANK[left.extractionMethod] ?? 99) - (EXTRACTION_RANK[right.extractionMethod] ?? 99)),
    rawDocumentCounts: mapRawDocumentCounts(rawRows),
    offerCountsBySourceType,
    activeNowBySourceType,
    hasOfficialHtml: hasMethod(entries, 'official-html'),
    hasOfficialStructuredJson: hasMethod(entries, 'structured-json'),
    hasAggregatorJson: hasMethod(entries, 'aggregator-json'),
    hasOfficialPdf: hasMethod(entries, 'pdf-textlayer'),
    hasViewerDocument: hasMethod(entries, 'viewer-metadata'),
    hasPdfTextLayerCheck: hasMethod(entries, 'pdf-textlayer') || rawRows.some((row) => (row.documentType || row._id?.documentType) === 'pdf'),
    hasOcrDiagnostics: hasMethod(entries, 'ocr-bbox'),
    recommendedPrimarySource: sourceSummary(primary),
    recommendedSupplementalSources: supplemental.slice(0, 5),
    ocrRole: determineOcrRole(entries, primary),
    risks: buildRetailerRisks({ entries, offerCounts: offerCountsBySourceType, rawRows, duplicateRows }),
    nextActions: buildNextActions({ primary, entries, offerCounts: offerCountsBySourceType }),
  };
}

function buildGlobalAudit(retailers = []) {
  const withGoodStructuredSource = retailers
    .filter((item) => item.hasOfficialStructuredJson || item.hasOfficialHtml)
    .map((item) => item.retailerKey);
  const onlyPdfOrViewer = retailers
    .filter((item) => (item.hasOfficialPdf || item.hasViewerDocument) && !item.hasOfficialStructuredJson && !item.hasOfficialHtml && !item.hasAggregatorJson)
    .map((item) => item.retailerKey);
  const highDuplicateRisk = retailers
    .filter((item) => item.risks.some((risk) => /Dubletten|Duplicate/i.test(risk)))
    .map((item) => item.retailerKey);
  const ocrNotProductive = retailers
    .filter((item) => item.ocrRole === 'none' || item.ocrRole === 'diagnostic-only' || item.ocrRole === 'fallback-only')
    .map((item) => item.retailerKey);
  const needsSourcePrioritization = retailers
    .filter((item) => {
      const primaryMethod = item.recommendedPrimarySource?.extractionMethod || '';
      return (
        !['structured-json', 'official-html'].includes(primaryMethod)
        || item.risks.some((risk) => /Dubletten|Keine belastbare/i.test(risk))
      );
    })
    .map((item) => item.retailerKey);

  return {
    retailersWithGoodStructuredSource: withGoodStructuredSource,
    retailersWithOnlyPdfOrViewer: onlyPdfOrViewer,
    retailersWithHighDuplicateRisk: highDuplicateRisk,
    retailersWhereOcrIsNotProductiveNow: ocrNotProductive,
    retailersWhereSourcePrioritizationShouldImproveFirst: needsSourcePrioritization,
    launchReadinessOrder: [...retailers]
      .sort((left, right) => {
        const leftRank = EXTRACTION_RANK[left.recommendedPrimarySource?.extractionMethod] ?? 99;
        const rightRank = EXTRACTION_RANK[right.recommendedPrimarySource?.extractionMethod] ?? 99;
        const leftActive = Object.values(left.activeNowBySourceType || {}).reduce((sum, value) => sum + Number(value || 0), 0);
        const rightActive = Object.values(right.activeNowBySourceType || {}).reduce((sum, value) => sum + Number(value || 0), 0);

        if (leftRank !== rightRank) {
          return leftRank - rightRank;
        }

        return rightActive - leftActive;
      })
      .map((item) => ({
        retailerKey: item.retailerKey,
        primary: item.recommendedPrimarySource?.extractionMethod || 'unknown',
        activeNow: Object.values(item.activeNowBySourceType || {}).reduce((sum, value) => sum + Number(value || 0), 0),
      })),
    topThreeNextDataQualityBlocks: [
      'Source-Prioritaet und Cross-Source-Dedupe pro Haendler verbindlich machen.',
      'Offizielle strukturierte/HTML-Quellen fuer BILLA, BIPA, LIDL, HOFER und PENNY gegen Aggregator-Coverage absichern.',
      'PDF/OCR als Evidence-Fallback kapseln: Textlayer-Qualitaet messen, OCR nicht produktiv ranken.',
    ],
  };
}

function loadCodeHints(projectRoot = process.cwd()) {
  const hints = {
    parserHints: [],
    ocrDiagnosticFiles: [],
    crawlerFiles: [],
  };
  const crawlDir = path.join(projectRoot, 'src', 'services', 'crawl');
  const scriptsDir = path.join(projectRoot, 'scripts');

  for (const dir of [crawlDir, scriptsDir]) {
    if (!fs.existsSync(dir)) {
      continue;
    }

    for (const file of fs.readdirSync(dir)) {
      const lower = file.toLowerCase();

      if (/crawler|parser/.test(lower)) {
        hints.crawlerFiles.push(path.relative(projectRoot, path.join(dir, file)));
      }

      if (/ocr|pdf/.test(lower)) {
        hints.ocrDiagnosticFiles.push(path.relative(projectRoot, path.join(dir, file)));
      }
    }
  }

  hints.parserHints = uniq([...hints.crawlerFiles, ...hints.ocrDiagnosticFiles]).sort();
  hints.crawlerFiles = uniq(hints.crawlerFiles).sort();
  hints.ocrDiagnosticFiles = uniq(hints.ocrDiagnosticFiles).sort();

  return hints;
}

function buildCodeHintSourceEntries(codeHints = {}) {
  const hintText = [
    ...(codeHints.parserHints || []),
    ...(codeHints.ocrDiagnosticFiles || []),
    ...(codeHints.crawlerFiles || []),
  ].join(' ').toLowerCase();
  const entries = [];

  if (/penny.*(?:ocr|pdf)|(?:ocr|pdf).*penny/.test(hintText)) {
    entries.push({
      retailerKey: 'penny',
      retailerName: 'PENNY',
      channel: 'other',
      label: 'PENNY PDF/OCR Diagnostics',
      sourceUrl: '',
      sourceType: 'penny-ocr-diagnostics',
      parserHint: 'ocr-bbox diagnostics only',
      enabled: true,
      latestStatus: 'diagnostic-only',
    });
  }

  return entries;
}

function buildSourcesLadderAudit({
  definitions = RETAILER_DEFINITIONS,
  sources = [],
  offerDistribution = [],
  rawDocumentDistribution = [],
  duplicateSignals = [],
  codeHints = {},
  generatedAt = new Date(),
} = {}) {
  const sourcesWithCodeHints = [
    ...sources,
    ...buildCodeHintSourceEntries(codeHints),
  ];
  const definitionsByRetailer = byRetailer(definitions);
  const sourcesByRetailer = byRetailer(sourcesWithCodeHints);
  const offersByRetailer = byRetailer(offerDistribution);
  const rawByRetailer = byRetailer(rawDocumentDistribution);
  const duplicatesByRetailer = byRetailer(duplicateSignals);
  const retailerAudits = TARGET_RETAILERS.map((retailer) => buildRetailerAudit({
    retailer,
    definitions: definitionsByRetailer.get(retailer.retailerKey) || [],
    sources: sourcesByRetailer.get(retailer.retailerKey) || [],
    offerRows: offersByRetailer.get(retailer.retailerKey) || [],
    rawRows: rawByRetailer.get(retailer.retailerKey) || [],
    duplicateRows: duplicatesByRetailer.get(retailer.retailerKey) || [],
  }));

  return {
    ok: true,
    readOnly: true,
    mutatedCollections: [],
    generatedAt: generatedAt instanceof Date ? generatedAt.toISOString() : generatedAt,
    sourcePriorityLadder: [
      'official-structured-json',
      'official-html',
      'aggregator-json',
      'viewer-metadata',
      'pdf-textlayer',
      'ocr-bbox-fallback-only',
    ],
    principle: 'Qualitaet der Daten ist kein Nebenthema - sie IST das Produkt.',
    retailers: retailerAudits,
    global: buildGlobalAudit(retailerAudits),
    codeHints,
  };
}

module.exports = {
  TARGET_RETAILERS,
  EXTRACTION_RANK,
  inferExtractionMethod,
  buildSourceEvidenceEntries,
  buildRetailerAudit,
  buildSourcesLadderAudit,
  loadCodeHints,
};
