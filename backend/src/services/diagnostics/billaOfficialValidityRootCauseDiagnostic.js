const TARGET_RETAILERS = [
  { retailerKey: 'billa', displayName: 'BILLA' },
  { retailerKey: 'billa-plus', displayName: 'BILLA PLUS' },
];

const SOURCE_TYPE = 'billa-official-algolia';
const QUERY_MAX_TIME_MS = 2000;
const DEFAULT_LIMIT = 2500;
const EXAMPLE_LIMIT = 5;

const HIDDEN_VALIDITY_PATH_PATTERN = /(^|\.)(valid|validity|validFrom|validTo|from|to|date|start|end|promotion|campaign|legal|disclaimer|badge|badges|subtitle|teaser|aktion|conditions?|availability|activeFrom|activeTo|visibleFrom|visibleTo|offerStartDate|offerEndDate)(\.|$)/i;
const CAMPAIGN_PATH_PATTERN = /(^|\.)(campaign|promotion|legal|disclaimer|badge|badges|subtitle|teaser|aktion)(\.|$)/i;
const FETCHED_AT_PATH_PATTERN = /(^|\.)(createdAt|updatedAt|fetchedAt|observedAt|firstSeenAt|lastSeenAt|latestRunAt)(\.|$)/i;

const CODE_FINDINGS = [
  {
    file: 'src/services/crawl/officialSourceCrawler.js',
    functionOrArea: 'fetchBillaAlgoliaPromotionHits',
    finding: 'BILLA/BILLA PLUS official promotions are fetched from Algolia product search with filters=inPromotion:true.',
    risk: 'The query proves current promotion membership, but not an offer-level validity end date.',
  },
  {
    file: 'src/services/crawl/officialSourceCrawler.js',
    functionOrArea: 'normalizeBillaPromotionToOffer',
    finding: 'BILLA official offers are mapped with validFrom: new Date() and validTo: null.',
    risk: 'validTo is intentionally left empty unless explicit upstream validity is added later.',
  },
  {
    file: 'src/services/crawl/officialSourceCrawler.js',
    functionOrArea: 'normalizeBillaPromotionToOffer rawFacts',
    finding: 'Stored rawFacts keep objectID, sku, category, regular/loyalty tags and snapshotCurrent, but not the full Algolia hit.',
    risk: 'Any upstream campaign/date fields outside this compact subset are not available on Offer documents.',
  },
  {
    file: 'src/services/crawl/officialSourceCrawler.js',
    functionOrArea: 'buildBillaConditionsText',
    finding: 'conditionsText is mapped only from price.regular.promotionText and price.loyalty.promotionText.',
    risk: 'Legal/campaign text may be partial; condition and validity evidence can be separate upstream concepts.',
  },
  {
    file: 'src/services/crawl/officialSourceCrawler.js',
    functionOrArea: 'crawlBillaOfficialPromotions RawDocument',
    finding: 'RawDocument payload stores hitCount and sampleNames only, not full Algolia hit payloads.',
    risk: 'Current RawDocuments cannot prove whether Algolia returned hidden validity fields.',
  },
  {
    file: 'src/services/sources/sourceDefinitions.js',
    functionOrArea: 'BILLA and BILLA PLUS official source definitions',
    finding: 'BILLA and BILLA PLUS are separate source definitions but share the same official BILLA action URLs.',
    risk: 'Retailer scope must be proven per offer or campaign before any validity/source-priority fix is trusted.',
  },
  {
    file: 'src/services/crawl/offerAuditEnrichment.js',
    functionOrArea: 'buildReviewReasons / buildQualityWithValidity',
    finding: 'Offers without reliable validTo receive incomplete-validity review signals and quality penalty.',
    risk: 'This is diagnostic/quality handling, not a cause of validTo being dropped.',
  },
];

function pct(part, total) {
  if (!total) return 0;
  return Number(((Number(part || 0) / Number(total || 0)) * 100).toFixed(1));
}

function dateKey(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function truncate(value, maxLength = 180) {
  const text = stringify(value).replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function stringify(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (['string', 'number', 'boolean'].includes(typeof value)) return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function unique(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function normalizeText(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeDuplicateTitle(value = '') {
  return normalizeText(value).split(/\s+/).slice(0, 10).join(' ');
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
  const urlRanges = text.match(/\b\d{2}-\d{2}-20\d{2}-\d{2}-\d{2}-20\d{2}\b/g) || [];
  return isoDates.length + dotDates.length >= 2 || urlRanges.length > 0;
}

function walkFields(value, prefix = '', output = [], { maxArrayItems = 12 } = {}) {
  if (value === null || value === undefined) return output;

  if (value instanceof Date || ['string', 'number', 'boolean'].includes(typeof value)) {
    output.push({ path: prefix, value });
    return output;
  }

  if (Array.isArray(value)) {
    value.slice(0, maxArrayItems).forEach((item, index) => {
      walkFields(item, prefix ? `${prefix}.${index}` : String(index), output, { maxArrayItems });
    });
    return output;
  }

  if (typeof value === 'object') {
    Object.entries(value).forEach(([key, nested]) => {
      walkFields(nested, prefix ? `${prefix}.${key}` : key, output, { maxArrayItems });
    });
  }

  return output;
}

function detectHiddenValidityFields(record = {}, rootName = '') {
  return walkFields(record)
    .map((field) => ({
      path: rootName ? `${rootName}.${field.path}` : field.path,
      value: field.value,
    }))
    .filter((field) => HIDDEN_VALIDITY_PATH_PATTERN.test(field.path) || /g[üu]ltig|gueltig|valid|aktion|promotion|campaign|legal|disclaimer|bis|von|ab/i.test(stringify(field.value)))
    .map((field) => {
      const fetchedAtOnly = FETCHED_AT_PATH_PATTERN.test(field.path);
      const campaignLevel = CAMPAIGN_PATH_PATTERN.test(field.path);
      const value = truncate(field.value);
      return {
        path: field.path,
        value,
        hasDate: hasDateToken(field.value),
        hasRange: hasDateRange(field.value),
        fetchedAtOnly,
        campaignLevel,
      };
    });
}

function hasOfferLevelRawValiditySignal(offer = {}) {
  return detectHiddenValidityFields({
    validityLabel: offer.validityLabel,
    rawFacts: offer.rawFacts || {},
    conditionsText: offer.conditionsText || '',
    description: offer.description || '',
  }).some((signal) => !signal.fetchedAtOnly && signal.hasDate && !signal.campaignLevel);
}

function hasCampaignLevelOnlySignal(signals = []) {
  const useful = signals.filter((signal) => !signal.fetchedAtOnly && (signal.hasDate || signal.hasRange || /g[üu]ltig|gueltig|bis|von|ab/i.test(signal.value)));
  return useful.length > 0 && useful.every((signal) => signal.campaignLevel || /legal|disclaimer|campaign|promotion|aktion/i.test(signal.path));
}

function summarizeOffer(offer = {}, extra = {}) {
  return {
    id: String(offer._id || ''),
    retailerKey: offer.retailerKey || '',
    retailerName: offer.retailerName || '',
    sourceType: offer.sourceType || '',
    sourceUrl: offer.sourceUrl || '',
    sourceId: String(offer.sourceId || ''),
    title: offer.title || '',
    priceCurrentAmount: offer.priceCurrent?.amount ?? offer.price?.amount ?? null,
    quantityText: offer.quantityText || '',
    unit: offer.unitType || offer.comparableUnit || offer.normalizedUnitPrice?.unit || '',
    normalizedUnitPriceAmount: offer.normalizedUnitPrice?.amount ?? null,
    validFrom: dateKey(offer.validFrom),
    validTo: dateKey(offer.validTo),
    validityLabel: offer.validityLabel || offer.rawFacts?.validityLabel || offer.rawFacts?.validityText || '',
    conditionsText: truncate(offer.conditionsText || '', 120),
    rawFactsPreview: shapeRawFactsPreview(offer.rawFacts || {}),
    createdAt: dateKey(offer.createdAt),
    updatedAt: dateKey(offer.updatedAt),
    ...extra,
  };
}

function shapeRawFactsPreview(rawFacts = {}) {
  const allowed = [
    'sourceType',
    'objectID',
    'sku',
    'category',
    'tags',
    'loyaltyTags',
    'snapshotCurrent',
    'validity',
    'validityText',
    'validFrom',
    'validTo',
    'campaign',
    'campaignId',
    'promotion',
  ];
  const output = {};

  for (const key of allowed) {
    if (rawFacts[key] === undefined) continue;
    if (Array.isArray(rawFacts[key])) {
      output[key] = rawFacts[key].slice(0, 8).map((item) => truncate(item, 80));
    } else if (rawFacts[key] && typeof rawFacts[key] === 'object') {
      output[key] = truncate(rawFacts[key], 240);
    } else {
      output[key] = rawFacts[key];
    }
  }

  return output;
}

function summarizeRawDocument(doc = {}) {
  const signals = detectHiddenValidityFields({
    title: doc.title,
    url: doc.url,
    canonicalUrl: doc.canonicalUrl,
    finalUrl: doc.finalUrl,
    contentSnippet: doc.contentSnippet,
    extractedPreview: doc.extractedPreview,
    payload: doc.payload || {},
  }, 'rawDocument');

  return {
    id: String(doc._id || ''),
    retailerKey: doc.retailerKey || '',
    sourceType: doc.sourceType || '',
    title: doc.title || '',
    url: doc.url || '',
    fetchedAt: dateKey(doc.fetchedAt),
    contentSnippet: truncate(doc.contentSnippet || '', 180),
    payloadKeys: Object.keys(doc.payload || {}).sort(),
    signals: signals.slice(0, 8),
  };
}

function buildFieldCoverage(offers = []) {
  const total = offers.length;
  const rawValidityEvidence = offers.filter(hasOfferLevelRawValiditySignal).length;
  const campaignOrLegalEvidence = offers.filter((offer) => {
    const signals = detectHiddenValidityFields({
      rawFacts: offer.rawFacts || {},
      conditionsText: offer.conditionsText || '',
      description: offer.description || '',
    });
    return signals.some((signal) => !signal.fetchedAtOnly && (signal.campaignLevel || /campaign|promotion|legal|disclaimer|aktion/i.test(signal.path)));
  }).length;

  return {
    total,
    validFromPresentCount: offers.filter((offer) => dateKey(offer.validFrom)).length,
    validToPresentCount: offers.filter((offer) => dateKey(offer.validTo)).length,
    validityLabelPresentCount: offers.filter((offer) => offer.validityLabel || offer.rawFacts?.validityLabel || offer.rawFacts?.validityText).length,
    conditionsTextPresentCount: offers.filter((offer) => String(offer.conditionsText || '').trim()).length,
    rawValidityEvidenceCount: rawValidityEvidence,
    campaignOrLegalEvidenceCount: campaignOrLegalEvidence,
    snapshotCurrentCount: offers.filter((offer) => offer.rawFacts?.snapshotCurrent === true).length,
    pricePresentCount: offers.filter((offer) => Number(offer.priceCurrent?.amount) > 0 || Number(offer.price?.amount) > 0).length,
    quantityPresentCount: offers.filter((offer) => offer.quantityText || offer.unitType || offer.comparableUnit || offer.normalizedUnitPrice?.unit).length,
    validToCoveragePct: pct(offers.filter((offer) => dateKey(offer.validTo)).length, total),
    rawValidityEvidencePct: pct(rawValidityEvidence, total),
  };
}

function classifyRootCause({ fieldCoverage = {}, offerSignals = [], rawDocumentSignals = [], codeFindings = CODE_FINDINGS } = {}) {
  if (fieldCoverage.validToPresentCount > 0 && fieldCoverage.validToPresentCount < fieldCoverage.total) {
    return 'validity-overwritten-or-dropped';
  }

  const usefulOfferSignals = offerSignals.filter((signal) => !signal.fetchedAtOnly && signal.hasDate);
  const usefulRawDocSignals = rawDocumentSignals.filter((signal) => !signal.fetchedAtOnly && signal.hasDate);

  if (usefulOfferSignals.some((signal) => !signal.campaignLevel)) {
    return 'validity-in-raw-lost-in-parser';
  }

  if (usefulRawDocSignals.some((signal) => !signal.campaignLevel)) {
    return 'validity-in-unmapped-field';
  }

  if (hasCampaignLevelOnlySignal([...usefulOfferSignals, ...usefulRawDocSignals])) {
    return 'validity-campaign-level-only';
  }

  if (codeFindings.some((finding) => /validTo: null/i.test(finding.finding)) || fieldCoverage.snapshotCurrentCount > 0) {
    return 'validity-not-in-source';
  }

  return 'unclear';
}

function buildDuplicateGroups(offers = [], { limit = EXAMPLE_LIMIT } = {}) {
  const groups = new Map();

  for (const offer of offers) {
    const key = [
      normalizeDuplicateTitle(offer.titleNormalized || offer.title || ''),
      Number(offer.priceCurrent?.amount || 0).toFixed(2),
      normalizeText(offer.quantityText || ''),
    ].join('::');

    if (!key.replace(/[:.0\s]/g, '')) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(offer);
  }

  return [...groups.values()]
    .filter((group) => new Set(group.map((offer) => offer.retailerKey)).size > 1)
    .sort((left, right) => right.length - left.length)
    .slice(0, limit)
    .map((group) => ({
      duplicateKey: [
        normalizeDuplicateTitle(group[0].titleNormalized || group[0].title || ''),
        Number(group[0].priceCurrent?.amount || 0).toFixed(2),
        normalizeText(group[0].quantityText || ''),
      ].join('::'),
      retailers: unique(group.map((offer) => offer.retailerKey)),
      offers: group.slice(0, 6).map((offer) => summarizeOffer(offer)),
      scopeRisk: 'same official Algolia sourceType/title/price observed across BILLA and BILLA PLUS; retailer applicability must not be inferred from validity alone',
    }));
}

function buildExamples({ retailerOffers = [], allOffers = [], rawDocuments = [] } = {}) {
  const rawDocSignals = rawDocuments.flatMap((doc) => summarizeRawDocument(doc).signals.map((signal) => ({ ...signal, doc })));
  const examplesWithPotentialRawValidity = retailerOffers
    .map((offer) => ({
      offer,
      signals: detectHiddenValidityFields({
        rawFacts: offer.rawFacts || {},
        validityLabel: offer.validityLabel,
        conditionsText: offer.conditionsText || '',
        description: offer.description || '',
      }).filter((signal) => !signal.fetchedAtOnly && signal.hasDate),
    }))
    .filter((item) => item.signals.length > 0)
    .slice(0, EXAMPLE_LIMIT)
    .map((item) => summarizeOffer(item.offer, { signals: item.signals.slice(0, 5) }));

  const examplesWithCampaignOrLegalText = retailerOffers
    .map((offer) => ({
      offer,
      signals: detectHiddenValidityFields({
        rawFacts: offer.rawFacts || {},
        conditionsText: offer.conditionsText || '',
        description: offer.description || '',
      }).filter((signal) => !signal.fetchedAtOnly && (signal.campaignLevel || /campaign|promotion|legal|disclaimer|aktion/i.test(signal.path))),
    }))
    .filter((item) => item.signals.length > 0)
    .slice(0, EXAMPLE_LIMIT)
    .map((item) => summarizeOffer(item.offer, { signals: item.signals.slice(0, 5) }));

  const examplesCouldBeSafelyFixed = examplesWithPotentialRawValidity
    .filter((example) => example.signals.some((signal) => signal.hasRange && !signal.campaignLevel))
    .slice(0, EXAMPLE_LIMIT);

  const examplesUnsafeToFix = retailerOffers
    .filter((offer) => !dateKey(offer.validTo))
    .slice(0, EXAMPLE_LIMIT)
    .map((offer) => summarizeOffer(offer, {
      reason: 'No explicit offer-level validTo evidence in stored Offer fields; crawl timestamp/snapshotCurrent is not a validity end date.',
    }));

  const rawDocumentExamples = rawDocSignals
    .filter((item) => !item.fetchedAtOnly)
    .slice(0, EXAMPLE_LIMIT)
    .map((item) => summarizeRawDocument(item.doc));

  return {
    examplesOfficialWithoutValidity: retailerOffers
      .filter((offer) => !dateKey(offer.validTo))
      .slice(0, EXAMPLE_LIMIT)
      .map(summarizeOffer),
    examplesWithPotentialRawValidity,
    examplesWithCampaignOrLegalText: examplesWithCampaignOrLegalText.length > 0 ? examplesWithCampaignOrLegalText : rawDocumentExamples,
    examplesBillaBillaPlusDuplicates: buildDuplicateGroups(allOffers),
    examplesCouldBeSafelyFixed,
    examplesUnsafeToFix,
  };
}

function buildRetailerSection({ retailerKey, offers = [], allOffers = [], rawDocuments = [] } = {}) {
  const retailerOffers = offers.filter((offer) => offer.retailerKey === retailerKey);
  const retailerRawDocuments = rawDocuments.filter((doc) => doc.retailerKey === retailerKey);
  const fieldCoverage = buildFieldCoverage(retailerOffers);
  const offerSignals = retailerOffers.flatMap((offer) => detectHiddenValidityFields({
    rawFacts: offer.rawFacts || {},
    validityLabel: offer.validityLabel,
    conditionsText: offer.conditionsText || '',
    description: offer.description || '',
  }, 'offer'));
  const rawDocumentSignals = retailerRawDocuments.flatMap((doc) => summarizeRawDocument(doc).signals);
  const rootCauseClassification = classifyRootCause({
    fieldCoverage,
    offerSignals,
    rawDocumentSignals,
  });
  const duplicateGroups = buildDuplicateGroups(allOffers);
  const scopeRisks = [];

  if (duplicateGroups.length > 0) {
    scopeRisks.push('scope-risk-billa-plus');
  }

  if (retailerRawDocuments.some((doc) => /Algolia Promotions/i.test(doc.title || '') && !Object.keys(doc.payload || {}).some((key) => /sample|hit/i.test(key) && key !== 'sampleNames'))) {
    scopeRisks.push('raw-document-compact-sample-only');
  }

  return {
    retailerKey,
    sourceKey: SOURCE_TYPE,
    officialCount: retailerOffers.length,
    fieldCoverage,
    rootCauseClassification,
    scopeRisks: unique(scopeRisks),
    rawDocumentSamples: retailerRawDocuments.slice(0, EXAMPLE_LIMIT).map(summarizeRawDocument),
    ...buildExamples({ retailerOffers, allOffers, rawDocuments: retailerRawDocuments }),
  };
}

function recommendedNextActions(retailers = []) {
  const actions = [
    'Keep source-priority and ranking safeguards unchanged.',
    'Inspect a tiny read-only/full Algolia hit sample for explicit offer-level start/end fields before any parser fix.',
    'If explicit per-hit validity exists, add a conservative parser-validity mapping with regression tests.',
    'If only campaign/legal-level validity exists, store it as evidence/uncertainty first, not as Offer.validTo.',
    'Audit BILLA/BILLA PLUS scope before trusting shared official Algolia promotions for replacement/dedupe.',
  ];

  if (retailers.every((retailer) => retailer.fieldCoverage.rawValidityEvidenceCount === 0)) {
    actions.push('Do not synthesize validTo from fetchedAt, createdAt, updatedAt or snapshotCurrent.');
  }

  return actions;
}

function buildSummary(retailers = []) {
  const billa = retailers.find((retailer) => retailer.retailerKey === 'billa');
  const billaPlus = retailers.find((retailer) => retailer.retailerKey === 'billa-plus');
  const rawValidityEvidenceCount = retailers.reduce((sum, retailer) => sum + Number(retailer.fieldCoverage.rawValidityEvidenceCount || 0), 0);
  const classifications = unique(retailers.map((retailer) => retailer.rootCauseClassification));
  const likelyRootCause = rawValidityEvidenceCount > 0
    ? 'Potential validity evidence exists in stored raw/unmapped fields; parser mapping must be audited conservatively.'
    : 'Stored BILLA/BILLA PLUS official Offers are current Algolia promotion snapshots: validFrom is crawl-time, validTo is intentionally null, and stored rawFacts/RawDocuments do not contain explicit offer-level validity end evidence.';

  return {
    likelyRootCause,
    billaOfficialCount: billa?.officialCount || 0,
    billaPlusOfficialCount: billaPlus?.officialCount || 0,
    validToCoverage: {
      billa: {
        count: billa?.fieldCoverage.validToPresentCount || 0,
        total: billa?.officialCount || 0,
        pct: billa?.fieldCoverage.validToCoveragePct || 0,
      },
      'billa-plus': {
        count: billaPlus?.fieldCoverage.validToPresentCount || 0,
        total: billaPlus?.officialCount || 0,
        pct: billaPlus?.fieldCoverage.validToCoveragePct || 0,
      },
    },
    rawValidityEvidenceCount,
    rootCauseClassifications: classifications,
    recommendedNextActions: recommendedNextActions(retailers),
  };
}

async function fetchReadOnlyContext({ Offer, RawDocument, Source, limit = DEFAULT_LIMIT, rawDocumentLimit = 30 } = {}) {
  const retailerKeys = TARGET_RETAILERS.map((retailer) => retailer.retailerKey);
  const [offers, rawDocuments, sources] = await Promise.all([
    Offer
      ? Offer.find({ retailerKey: { $in: retailerKeys }, sourceType: SOURCE_TYPE })
        .sort({ retailerKey: 1, titleNormalized: 1, updatedAt: -1 })
        .limit(Math.max(100, Math.min(Number(limit || DEFAULT_LIMIT), 10000)))
        .select([
          '_id sourceId retailerKey retailerName title titleNormalized brand sourceType sourceUrl sourceKey sourceName',
          'validFrom validTo validityLabel conditionsText description rawFacts',
          'priceCurrent price quantityText unitType comparableUnit normalizedUnitPrice',
          'createdAt updatedAt firstSeenAt lastSeenAt',
        ].join(' '))
        .maxTimeMS(QUERY_MAX_TIME_MS)
        .lean()
      : [],
    RawDocument
      ? RawDocument.find({
        retailerKey: { $in: retailerKeys },
        $or: [
          { title: /Algolia Promotions/i },
          { contentSnippet: /Official BILLA promotion hits/i },
          { 'payload.retailerKey': { $in: retailerKeys } },
        ],
      })
        .sort({ fetchedAt: -1 })
        .limit(Math.max(0, Math.min(Number(rawDocumentLimit || 30), 100)))
        .select('_id sourceId crawlJobId retailerKey sourceType documentType url canonicalUrl finalUrl title fetchedAt contentSnippet extractedPreview foundRawItems parsedOffers parserVersion payload createdAt updatedAt')
        .maxTimeMS(QUERY_MAX_TIME_MS)
        .lean()
      : [],
    Source
      ? Source.find({ retailerKey: { $in: retailerKeys } })
        .select('_id retailerKey retailerName channel label sourceUrl sourceType parserHint parserVersion latestRunAt latestStatus createdAt updatedAt')
        .maxTimeMS(QUERY_MAX_TIME_MS)
        .lean()
      : [],
  ]);

  return { offers, rawDocuments, sources };
}

async function buildBillaOfficialValidityRootCauseDiagnostic({
  Offer,
  RawDocument,
  Source,
  generatedAt = new Date(),
  limit = DEFAULT_LIMIT,
  rawDocumentLimit = 30,
  context,
} = {}) {
  const readOnlyContext = context || await fetchReadOnlyContext({
    Offer,
    RawDocument,
    Source,
    limit,
    rawDocumentLimit,
  });
  const offers = readOnlyContext.offers || [];
  const rawDocuments = readOnlyContext.rawDocuments || [];
  const retailers = TARGET_RETAILERS.map((retailer) => buildRetailerSection({
    retailerKey: retailer.retailerKey,
    offers,
    allOffers: offers,
    rawDocuments,
  }));

  return {
    ok: true,
    readOnly: true,
    mutatedCollections: [],
    generatedAt: generatedAt instanceof Date ? generatedAt.toISOString() : generatedAt,
    principle: 'Qualitaet der Daten ist kein Nebenthema - sie IST das Produkt.',
    diagnosticOnly: true,
    summary: buildSummary(retailers),
    codeFindings: CODE_FINDINGS,
    retailers,
    sourceContext: {
      sources: (readOnlyContext.sources || []).map((source) => ({
        id: String(source._id || ''),
        retailerKey: source.retailerKey || '',
        channel: source.channel || '',
        label: source.label || '',
        sourceUrl: source.sourceUrl || '',
        sourceType: source.sourceType || '',
        latestStatus: source.latestStatus || '',
      })),
    },
  };
}

module.exports = {
  CODE_FINDINGS,
  DEFAULT_LIMIT,
  SOURCE_TYPE,
  TARGET_RETAILERS,
  buildBillaOfficialValidityRootCauseDiagnostic,
  buildDuplicateGroups,
  buildFieldCoverage,
  classifyRootCause,
  detectHiddenValidityFields,
  fetchReadOnlyContext,
  hasCampaignLevelOnlySignal,
  shapeRawFactsPreview,
  summarizeOffer,
};
