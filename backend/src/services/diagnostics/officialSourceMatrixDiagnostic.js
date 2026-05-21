const { RETAILER_DEFINITIONS } = require('../sources/sourceDefinitions');

const QUERY_MAX_TIME_MS = 1500;
const DEFAULT_LIMIT = 20;

const OFFICIAL_RETAILERS = [
  {
    retailerKey: 'spar',
    displayName: 'SPAR',
    officialUrls: ['https://www.spar.at/aktionen/steiermark', 'https://www.spar.at/aktionen'],
    retailerKeysForDb: ['spar'],
    sourceRetailerFormatsForDb: ['spar'],
    expectedOfficialSourceTypes: ['spar-official-pdf', 'official-action'],
    parserNotes: ['SPAR official actions and direct official PDF snapshots are separate official-first sources.'],
  },
  {
    retailerKey: 'eurospar',
    displayName: 'EUROSPAR',
    officialUrls: ['https://www.spar.at/aktionen/steiermark'],
    retailerKeysForDb: ['eurospar'],
    sourceRetailerFormatsForDb: ['eurospar'],
    expectedOfficialSourceTypes: ['spar-official-pdf'],
    parserNotes: ['EUROSPAR official PDF source uses retailerKey=eurospar and sourceRetailerFormat=eurospar.'],
  },
  {
    retailerKey: 'interspar',
    displayName: 'INTERSPAR',
    officialUrls: ['https://www.interspar.at/aktionen', 'https://www.spar.at/aktionen/steiermark'],
    retailerKeysForDb: ['interspar'],
    sourceRetailerFormatsForDb: ['interspar'],
    expectedOfficialSourceTypes: ['spar-official-pdf', 'official-action'],
    parserNotes: ['INTERSPAR official PDF/action sources use retailerKey=interspar and sourceRetailerFormat=interspar.'],
  },
  {
    retailerKey: 'billa',
    displayName: 'BILLA',
    officialUrls: ['https://www.billa.at/unsere-aktionen/aktionen'],
    retailerKeysForDb: ['billa'],
    expectedOfficialSourceTypes: ['billa-official-algolia'],
    parserNotes: ['officialSourceCrawler has BILLA Algolia/official-site normalization branch.'],
  },
  {
    retailerKey: 'billa-plus',
    displayName: 'BILLA PLUS',
    officialUrls: ['https://www.billa.at/unsere-aktionen/aktionen'],
    retailerKeysForDb: ['billa-plus'],
    expectedOfficialSourceTypes: ['billa-official-algolia'],
    parserNotes: ['Shares BILLA official action path; retailer scope separation is the key risk.'],
  },
  {
    retailerKey: 'hofer',
    displayName: 'HOFER',
    officialUrls: ['https://www.hofer.at/de/angebote.html'],
    retailerKeysForDb: ['hofer'],
    expectedOfficialSourceTypes: ['hofer-official-html'],
    parserNotes: ['officialSourceCrawler has HOFER official HTML/flyer handling.'],
  },
  {
    retailerKey: 'dm',
    displayName: 'dm',
    officialUrls: ['https://www.dm.at/search?query=angebote&searchProviderType=dm-products&currentPage=2&loadPrev=false'],
    retailerKeysForDb: ['dm'],
    expectedOfficialSourceTypes: ['dm-official-product-search'],
    parserNotes: ['officialSourceCrawler has dm Ausverkauf product-search handling.'],
  },
  {
    retailerKey: 'bipa',
    displayName: 'BIPA',
    officialUrls: ['https://www.bipa.at/cp/aktionen-uebersicht'],
    retailerKeysForDb: ['bipa'],
    expectedOfficialSourceTypes: ['bipa-official-html'],
    parserNotes: ['Code source uses bipa.at/cp/aktionen; requested overview URL is adjacent but not exact.'],
  },
  {
    retailerKey: 'lidl',
    displayName: 'Lidl',
    officialUrls: ['https://www.lidl.at/'],
    retailerKeysForDb: ['lidl'],
    expectedOfficialSourceTypes: ['lidl-official-flyer-api'],
    parserNotes: ['officialSourceCrawler has Lidl flyer API branch for configured flyer URL.'],
  },
  {
    retailerKey: 'pagro',
    displayName: 'PAGRO',
    officialUrls: ['https://www.pagro.at/angebote'],
    retailerKeysForDb: ['pagro'],
    expectedOfficialSourceTypes: ['pagro-official-html'],
    parserNotes: ['Official PAGRO source is registered disabled because local Node fetches hit Cloudflare challenge.'],
  },
  {
    retailerKey: 'penny',
    displayName: 'PENNY',
    officialUrls: ['https://www.penny.at/angebote'],
    retailerKeysForDb: ['penny'],
    expectedOfficialSourceTypes: ['penny-official-html', 'penny-official-pdf'],
    parserNotes: ['officialSourceCrawler has PENNY HTML and PDF/flyer handling; OCR diagnostics exist separately.'],
  },
  {
    retailerKey: 'adeg',
    displayName: 'ADEG',
    officialUrls: ['https://www.adeg.at/flugblatt-aktionen/adeg-flugblatt'],
    retailerKeysForDb: ['adeg'],
    expectedOfficialSourceTypes: ['adeg-official-pdf', 'adeg-official-html'],
    parserNotes: ['ADEG official flyer source is registered disabled; no reliable item-level parser is active.'],
  },
];

function compact(values = []) {
  return values.map((value) => String(value || '').trim()).filter(Boolean);
}

function uniqueCompact(values = []) {
  return [...new Set(compact(values))];
}

function pct(part, total) {
  if (!total) return 0;
  return Math.round((Number(part || 0) / Number(total || 0)) * 1000) / 10;
}

function classifySourceKind(source = {}) {
  const haystack = `${source.channel || ''} ${source.sourceType || ''} ${source.sourceUrl || ''} ${source.label || ''}`.toLowerCase();

  if (/official|billa\.at|hofer\.at|dm\.at|bipa\.at|lidl\.at|penny\.at|spar\.at|pagro\.at|adeg\.at/.test(haystack)) return 'official';
  if (/aktionsfinder|wogibtswas/.test(haystack)) return 'aggregator';
  if (/marktguru/.test(haystack)) return 'marketplace';
  return 'unknown';
}

function deriveSourceKey(source = {}) {
  const url = String(source.sourceUrl || '').toLowerCase();
  const format = source.sourceRetailerFormat || source.retailerKey || 'unknown';

  if (url.includes('aktionsfinder.at')) return `aktionsfinder-${format}`;
  if (url.includes('marktguru.at')) return `marktguru-${format}`;
  if (url.includes('wogibtswas.at')) return `wogibtswas-${format}`;
  if (url.includes('spar.at/aktionen/steiermark')) return 'spar-official-actions-steiermark';
  if (url.includes('interspar.at/aktionen')) return 'interspar-official-actions';
  if (url.includes('flugblatt.interspar.at')) return 'interspar-official-flyer-pdf';
  if (url.includes('flugblatt.spar.at') && format === 'eurospar') return 'eurospar-official-flyer-pdf';
  if (url.includes('flugblatt.spar.at') && format === 'spar') return 'spar-official-flyer-pdf';
  if (url.includes('spar.at')) return 'spar-official-flyer';
  if (url.includes('billa.at')) return `${source.retailerKey || 'billa'}-official`;
  if (url.includes('hofer.at')) return 'hofer-official-flyer';
  if (url.includes('dm.at')) return 'dm-official-site';
  if (url.includes('bipa.at')) return 'bipa-official-site';
  if (url.includes('lidl.at')) return 'lidl-official-flyer';
  if (url.includes('penny.at')) return source.channel === 'official-flyer' ? 'penny-official-flyer' : 'penny-official-site';
  if (url.includes('pagro.at')) return 'pagro-official-site';
  if (url.includes('adeg.at')) return 'adeg-official-flyer';

  return uniqueCompact([source.channel, source.retailerKey, format]).join('-') || 'unknown';
}

function inferParserHints(source = {}) {
  const url = String(source.sourceUrl || '').toLowerCase();
  const channel = source.channel || '';
  const hints = [];

  if (channel === 'official-site' || channel === 'official-flyer') hints.push('officialSourceCrawler');
  if (url.includes('aktionsfinder.at')) hints.push('aktionsfinderCrawler/aktionsfinderParser');
  if (url.includes('marktguru.at')) hints.push('marketguruCrawler');
  if (url.includes('lidl.at/c/flugblatt')) hints.push('lidl-official-flyer-api');
  if (url.includes('penny.at/angebote/flugblaetter')) hints.push('penny-official-pdf-branch');
  if (url.includes('spar.at/aktionen')) hints.push('spar-official-parser-fixture-only');
  if (url.includes('flugblatt.spar.at') || url.includes('flugblatt.interspar.at')) hints.push('spar-official-pdf');
  if (url.includes('billa.at')) hints.push('billa-official-algolia');
  if (url.includes('bipa.at')) hints.push('bipa-official-html');
  if (url.includes('hofer.at')) hints.push('hofer-official-html');
  if (url.includes('pagro.at')) hints.push('pagro-official-html-disabled');
  if (url.includes('adeg.at')) hints.push('adeg-official-disabled');

  return uniqueCompact(hints);
}

function isBlockedLikely(status) {
  return [401, 403, 407, 429, 451].includes(Number(status));
}

function normalizeCodeSource(definition = {}, file = 'src/services/sources/sourceDefinitions.js') {
  const enabled = definition.enabled !== false;
  const latestStatus = definition.latestStatus || '';

  return {
    sourceKey: deriveSourceKey(definition),
    file,
    retailerKey: definition.retailerKey || '',
    retailerName: definition.retailerName || '',
    sourceRetailerName: definition.sourceRetailerName || '',
    sourceRetailerFormat: definition.sourceRetailerFormat || '',
    appliesToRetailerFormats: definition.appliesToRetailerFormats || [],
    retailerFormatLabel: definition.retailerFormatLabel || '',
    sourceType: definition.sourceType || (definition.channel === 'official-flyer' ? 'flyer' : definition.channel === 'official-site' ? 'offers-page' : definition.channel || 'other'),
    channel: definition.channel || '',
    sourceUrl: definition.sourceUrl || '',
    enabled,
    active: enabled && latestStatus !== 'inactive',
    disabledReason: definition.disabledReason || '',
    sourceKind: classifySourceKind(definition),
    parserOrAdapter: inferParserHints(definition),
    capabilities: definition.capabilities || {},
    parserHint: definition.parserHint || '',
    parserVersion: definition.parserVersion || '',
    notes: definition.notes || '',
  };
}

function getRetailerConfigs() {
  return OFFICIAL_RETAILERS.map((retailer) => ({
    ...retailer,
    codeSources: RETAILER_DEFINITIONS
      .filter((definition) => {
        const retailerKeys = retailer.retailerKeysForDb || [retailer.retailerKey];
        const formatKeys = retailer.sourceRetailerFormatsForDb || [];
        const keys = [definition.retailerKey, definition.sourceRetailerFormat, ...(definition.appliesToRetailerFormats || [])];
        return keys.some((key) => retailerKeys.includes(key) || formatKeys.includes(key));
      })
      .map((definition) => normalizeCodeSource(definition)),
  }));
}

function ratioObject(count, total) {
  return {
    count: Number(count || 0),
    total: Number(total || 0),
    pct: pct(count, total),
  };
}

function buildCoverageRatios(row = {}) {
  const total = Number(row.offerCountApprox || row.total || 0);

  return {
    validityCoverageApprox: {
      validFromPresent: ratioObject(row.validFromPresent, total),
      validToPresent: ratioObject(row.validToPresent, total),
      validityLabelPresent: ratioObject(row.validityLabelPresent, total),
    },
    priceCoverageApprox: {
      priceCurrentPresent: ratioObject(row.priceCurrentPresent, total),
      priceAmountPresent: ratioObject(row.priceAmountPresent, total),
    },
    quantityCoverageApprox: {
      quantityTextPresent: ratioObject(row.quantityTextPresent, total),
      normalizedUnitPricePresent: ratioObject(row.normalizedUnitPricePresent, total),
      comparableUnitPresent: ratioObject(row.comparableUnitPresent, total),
    },
    conditionCoverageApprox: {
      conditionsTextPresent: ratioObject(row.conditionsTextPresent, total),
      conditionFlagPresent: ratioObject(row.conditionFlagPresent, total),
    },
  };
}

function summarizeOffer(offer = {}) {
  return {
    id: String(offer._id || ''),
    title: offer.title || '',
    retailerKey: offer.retailerKey || '',
    retailerName: offer.retailerName || '',
    sourceType: offer.sourceType || '',
    sourceUrl: offer.sourceUrl || '',
    sourceRetailerFormat: offer.sourceRetailerFormat || '',
    priceCurrent: offer.priceCurrent?.amount ?? null,
    quantityText: offer.quantityText || '',
    validFrom: offer.validFrom ? new Date(offer.validFrom).toISOString().slice(0, 10) : null,
    validTo: offer.validTo ? new Date(offer.validTo).toISOString().slice(0, 10) : null,
    conditionsText: offer.conditionsText || '',
  };
}

function emptyDbCoverage() {
  return {
    offerCountApprox: 0,
    activeOfferCountApprox: 0,
    sourceBreakdown: [],
    categoryBreakdown: [],
    countBySourceType: [],
    countBySourceKey: [],
    countBySourceName: [],
    ...buildCoverageRatios({ offerCountApprox: 0 }),
    examplesTopOffers: [],
    examplesWithOfficialSource: [],
    examplesWithAggregatorSource: [],
  };
}

function sourceTypeIsOfficial(sourceType = '') {
  return /official/i.test(String(sourceType || ''));
}

function sourceTypeIsAggregator(sourceType = '') {
  return /aktionsfinder|aggregator|wogibtswas|marktguru/i.test(String(sourceType || ''));
}

async function fetchDbCoverageForRetailer({ Offer, retailer, limit = DEFAULT_LIMIT }) {
  if (!Offer) return emptyDbCoverage();

  const retailerKeys = retailer.retailerKeysForDb || [retailer.retailerKey];
  const formatKeys = retailer.sourceRetailerFormatsForDb || [];
  const match = formatKeys.length > 0
    ? {
        retailerKey: { $in: retailerKeys },
        $or: [
          { sourceRetailerFormat: { $in: formatKeys } },
          { appliesToRetailerFormats: { $in: formatKeys } },
          { retailerFormats: { $in: formatKeys } },
        ],
      }
    : { retailerKey: { $in: retailerKeys } };
  const boundedLimit = Math.max(5, Math.min(Number(limit || DEFAULT_LIMIT), 50));

  const [
    aggregateRows,
    sourceBreakdown,
    categoryBreakdown,
    examplesTopOffers,
    examplesWithOfficialSource,
    examplesWithAggregatorSource,
  ] = await Promise.all([
    Offer.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          offerCountApprox: { $sum: 1 },
          activeOfferCountApprox: { $sum: { $cond: [{ $or: ['$isActiveNow', '$isActiveToday'] }, 1, 0] } },
          validFromPresent: { $sum: { $cond: ['$validFrom', 1, 0] } },
          validToPresent: { $sum: { $cond: ['$validTo', 1, 0] } },
          validityLabelPresent: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $gt: [{ $strLenCP: { $ifNull: ['$rawFacts.validityText', ''] } }, 0] },
                    { $gt: [{ $strLenCP: { $ifNull: ['$rawFacts.validityLabel', ''] } }, 0] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          priceCurrentPresent: { $sum: { $cond: [{ $gt: ['$priceCurrent.amount', 0] }, 1, 0] } },
          priceAmountPresent: { $sum: { $cond: [{ $gt: ['$priceCurrent.amount', 0] }, 1, 0] } },
          quantityTextPresent: { $sum: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$quantityText', ''] } }, 0] }, 1, 0] } },
          normalizedUnitPricePresent: { $sum: { $cond: [{ $gt: ['$normalizedUnitPrice.amount', 0] }, 1, 0] } },
          comparableUnitPresent: { $sum: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$comparableUnit', ''] } }, 0] }, 1, 0] } },
          conditionsTextPresent: { $sum: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$conditionsText', ''] } }, 0] }, 1, 0] } },
          conditionFlagPresent: {
            $sum: {
              $cond: [
                { $or: ['$hasConditions', '$customerProgramRequired', '$isMultiBuy'] },
                1,
                0,
              ],
            },
          },
        },
      },
    ]).option({ maxTimeMS: QUERY_MAX_TIME_MS }),
    Offer.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            sourceType: '$sourceType',
            sourceId: '$sourceId',
            sourceUrl: '$sourceUrl',
            sourceRetailerFormat: '$sourceRetailerFormat',
          },
          offers: { $sum: 1 },
          activeApprox: { $sum: { $cond: [{ $or: ['$isActiveNow', '$isActiveToday'] }, 1, 0] } },
          sampleTitle: { $first: '$title' },
        },
      },
      { $sort: { offers: -1 } },
      { $limit: 30 },
    ]).option({ maxTimeMS: QUERY_MAX_TIME_MS }),
    Offer.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            categoryKey: '$categoryKey',
            categoryPrimary: '$categoryPrimary',
            categorySecondary: '$categorySecondary',
          },
          offers: { $sum: 1 },
          activeApprox: { $sum: { $cond: [{ $or: ['$isActiveNow', '$isActiveToday'] }, 1, 0] } },
          sampleTitle: { $first: '$title' },
        },
      },
      { $sort: { offers: -1 } },
      { $limit: 20 },
    ]).option({ maxTimeMS: QUERY_MAX_TIME_MS }),
    Offer.find(match)
      .sort({ isActiveNow: -1, isActiveToday: -1, sortScoreDefault: -1, updatedAt: -1 })
      .limit(boundedLimit)
      .select('retailerKey retailerName sourceType sourceUrl sourceRetailerFormat title priceCurrent quantityText validFrom validTo conditionsText')
      .maxTimeMS(QUERY_MAX_TIME_MS)
      .lean(),
    Offer.find({ ...match, sourceType: /official/i })
      .sort({ isActiveNow: -1, updatedAt: -1 })
      .limit(Math.min(boundedLimit, 12))
      .select('retailerKey retailerName sourceType sourceUrl sourceRetailerFormat title priceCurrent quantityText validFrom validTo conditionsText')
      .maxTimeMS(QUERY_MAX_TIME_MS)
      .lean(),
    Offer.find({
      ...match,
      $or: [
        { sourceType: /aktionsfinder|aggregator|wogibtswas|marktguru/i },
        { sourceUrl: /aktionsfinder|wogibtswas|marktguru/i },
      ],
    })
      .sort({ isActiveNow: -1, updatedAt: -1 })
      .limit(Math.min(boundedLimit, 12))
      .select('retailerKey retailerName sourceType sourceUrl sourceRetailerFormat title priceCurrent quantityText validFrom validTo conditionsText')
      .maxTimeMS(QUERY_MAX_TIME_MS)
      .lean(),
  ]);

  const totals = aggregateRows[0] || {};
  const coverage = buildCoverageRatios(totals);
  const mappedSourceBreakdown = sourceBreakdown.map((row) => ({
    sourceType: row._id?.sourceType || '',
    sourceId: String(row._id?.sourceId || ''),
    sourceUrl: row._id?.sourceUrl || '',
    sourceRetailerFormat: row._id?.sourceRetailerFormat || '',
    offers: row.offers || 0,
    activeApprox: row.activeApprox || 0,
    sampleTitle: row.sampleTitle || '',
  }));

  return {
    offerCountApprox: totals.offerCountApprox || 0,
    activeOfferCountApprox: totals.activeOfferCountApprox || 0,
    sourceBreakdown: mappedSourceBreakdown,
    categoryBreakdown: categoryBreakdown.map((row) => ({
      categoryKey: row._id?.categoryKey || '',
      categoryPrimary: row._id?.categoryPrimary || '',
      categorySecondary: row._id?.categorySecondary || '',
      offers: row.offers || 0,
      activeApprox: row.activeApprox || 0,
      sampleTitle: row.sampleTitle || '',
    })),
    countBySourceType: mappedSourceBreakdown.map((row) => ({ sourceType: row.sourceType, count: row.offers })),
    countBySourceKey: mappedSourceBreakdown.map((row) => ({ sourceKey: row.sourceType || row.sourceUrl, count: row.offers })),
    countBySourceName: mappedSourceBreakdown.map((row) => ({ sourceName: row.sourceRetailerFormat || row.sourceType || 'unknown', count: row.offers })),
    ...coverage,
    examplesTopOffers: examplesTopOffers.map(summarizeOffer),
    examplesWithOfficialSource: examplesWithOfficialSource.map(summarizeOffer),
    examplesWithAggregatorSource: examplesWithAggregatorSource.map(summarizeOffer),
  };
}

function assessExistingParserCoverage({ retailer, codeSources = [], dbCoverage = emptyDbCoverage() } = {}) {
  const activeOfficialCode = codeSources.some((source) => source.sourceKind === 'official' && source.active);
  const disabledOfficialCode = codeSources.some((source) => source.sourceKind === 'official' && !source.active);
  const hasOfficialDbOffers = (dbCoverage.sourceBreakdown || []).some((row) => sourceTypeIsOfficial(row.sourceType));

  if (['spar', 'eurospar', 'interspar'].includes(retailer?.retailerKey) && disabledOfficialCode && !activeOfficialCode) return 'fixture-only';
  if (hasOfficialDbOffers || activeOfficialCode) return 'active';
  if (disabledOfficialCode || codeSources.some((source) => source.sourceKind === 'official')) return 'partial';
  return 'none';
}

function assessStructure({ retailer, reachability = [], codeSources = [], dbCoverage = emptyDbCoverage() } = {}) {
  const urlText = `${(retailer?.officialUrls || []).join(' ')} ${(codeSources || []).map((source) => source.sourceUrl).join(' ')}`.toLowerCase();
  const notes = `${(retailer?.parserNotes || []).join(' ')} ${(codeSources || []).map((source) => `${source.notes} ${source.parserOrAdapter?.join(' ')}`).join(' ')}`.toLowerCase();
  const blockedLikely = reachability.length > 0 ? reachability.some((row) => row.blockedLikely) : (retailer?.retailerKey === 'spar' ? true : null);
  const existingParserCoverage = assessExistingParserCoverage({ retailer, codeSources, dbCoverage });
  const hasOfficialDbOffers = (dbCoverage.sourceBreakdown || []).some((row) => sourceTypeIsOfficial(row.sourceType));

  return {
    htmlActionCardsLikely: /aktionen|angebote|official-html|html/.test(urlText + notes),
    apiLikely: /api|algolia|flyer-api|json/.test(notes),
    pdfFlyerLikely: /flugblatt|flyer|pdf|prospekt/.test(urlText + notes),
    requiresJsLikely: /search\?|aktionen|angebote/.test(urlText) && !/api|algolia/.test(notes),
    blockedLikely,
    existingParserCoverage,
    confidence: hasOfficialDbOffers || existingParserCoverage === 'active' ? 'high' : existingParserCoverage === 'partial' || existingParserCoverage === 'fixture-only' ? 'medium' : 'low',
  };
}

function assessRisks({ retailer, structureAssessment, dbCoverage = emptyDbCoverage() } = {}) {
  const risks = [];
  const officialRows = (dbCoverage.sourceBreakdown || []).filter((row) => sourceTypeIsOfficial(row.sourceType));
  const aggregatorRows = (dbCoverage.sourceBreakdown || []).filter((row) => sourceTypeIsAggregator(row.sourceType) || /aktionsfinder|marktguru|wogibtswas/i.test(row.sourceUrl));

  if (structureAssessment?.blockedLikely) risks.push('Official URL may be blocked or protected; do not bypass, use manual snapshot/allowed endpoints only.');
  if (officialRows.length === 0 && aggregatorRows.length > 0) risks.push('Official source would supplement existing aggregator coverage, not replace it.');
  if ((dbCoverage.priceCoverageApprox?.priceCurrentPresent?.pct || 0) < 70) risks.push('Low price coverage can make official-source dedupe unsafe if price-less items win.');
  if ((dbCoverage.validityCoverageApprox?.validToPresent?.pct || 0) < 70) risks.push('Weak validity coverage can hide currentness and expiry risk.');
  if (['spar', 'eurospar', 'interspar', 'billa', 'billa-plus'].includes(retailer?.retailerKey)) risks.push('Retailer-scope mapping must not merge market formats or BILLA/BILLA PLUS variants.');
  if ((dbCoverage.quantityCoverageApprox?.quantityTextPresent?.pct || 0) < 60) risks.push('Weak quantity coverage increases unsafe unit-price comparison risk.');

  return uniqueCompact(risks);
}

function recommendNextAction({ retailer, structureAssessment, codeSources = [], dbCoverage = emptyDbCoverage() } = {}) {
  const officialCode = codeSources.filter((source) => source.sourceKind === 'official');
  const hasOfficialDbOffers = (dbCoverage.sourceBreakdown || []).some((row) => sourceTypeIsOfficial(row.sourceType));

  if (['spar', 'eurospar', 'interspar'].includes(retailer?.retailerKey)) {
    return 'Keep aggregators active; harden SPAR official via manual snapshots or permitted structured evidence before any productive activation.';
  }

  if (officialCode.length === 0) {
    return 'Add a disabled official source definition and fixture/snapshot diagnostic before considering productive crawl work.';
  }

  if (!hasOfficialDbOffers && structureAssessment?.existingParserCoverage !== 'active') {
    return 'Build fixture-based parser diagnostics first; only promote fields with price, validity, quantity and condition evidence.';
  }

  if ((dbCoverage.validityCoverageApprox?.validToPresent?.pct || 0) < 70) {
    return 'Improve safe validity ingestion/evidence before using this source for dedupe or ranking decisions.';
  }

  return 'Audit official-vs-aggregator duplicate groups and fill precise missing field coverage without changing ranking.';
}

async function checkOfficialUrl(url, { fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
  if (typeof fetchImpl !== 'function') {
    return { url, status: null, contentType: '', contentLength: null, bytesSampled: 0, blockedLikely: null, redirects: [], notes: 'fetch-unavailable', markerChecks: {} };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response = await fetchImpl(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'text/html,*/*;q=0.8',
        'User-Agent': 'kaufklug-official-source-matrix/1.0 read-only diagnostic',
      },
    });
    let bodySample = '';

    if ([405, 403].includes(Number(response.status))) {
      response = await fetchImpl(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          Accept: 'text/html,*/*;q=0.8',
          Range: 'bytes=0-4095',
          'User-Agent': 'kaufklug-official-source-matrix/1.0 read-only diagnostic',
        },
      });
      bodySample = (await response.text()).slice(0, 4096);
    }

    const status = response.status;
    const contentType = response.headers?.get?.('content-type') || '';
    const contentLength = response.headers?.get?.('content-length') || null;

    return {
      url,
      status,
      contentType,
      contentLength: contentLength ? Number(contentLength) : null,
      bytesSampled: Buffer.byteLength(bodySample, 'utf8'),
      blockedLikely: isBlockedLikely(status),
      redirects: response.url && response.url !== url ? [{ from: url, to: response.url }] : [],
      notes: isBlockedLikely(status) ? 'blocked-or-rate-limited-likely' : '',
      markerChecks: bodySample ? {
        hasOfferText: /angebot|aktion|flugblatt|preis/i.test(bodySample),
        hasRetailerText: /spar|billa|hofer|dm|bipa|lidl|penny|pagro/i.test(bodySample),
      } : {},
    };
  } catch (error) {
    return { url, status: null, contentType: '', contentLength: null, bytesSampled: 0, blockedLikely: null, redirects: [], notes: `reachability-error:${error.message}`, markerChecks: {} };
  } finally {
    clearTimeout(timer);
  }
}

async function buildOfficialSourceMatrix({
  Offer,
  generatedAt = new Date(),
  limit = DEFAULT_LIMIT,
  checkUrls = false,
  fetchImpl,
} = {}) {
  const configs = getRetailerConfigs();
  const retailers = [];

  for (const retailer of configs) {
    const dbCoverage = await fetchDbCoverageForRetailer({ Offer, retailer, limit });
    const reachability = checkUrls
      ? await Promise.all(retailer.officialUrls.map((url) => checkOfficialUrl(url, { fetchImpl })))
      : [];
    const structureAssessment = assessStructure({
      retailer,
      codeSources: retailer.codeSources,
      dbCoverage,
      reachability,
    });
    const riskAssessment = assessRisks({ retailer, structureAssessment, dbCoverage });

    retailers.push({
      retailerKey: retailer.retailerKey,
      displayName: retailer.displayName,
      officialUrls: retailer.officialUrls,
      codeSources: retailer.codeSources,
      dbCoverage,
      reachability,
      structureAssessment,
      riskAssessment,
      recommendedNextAction: recommendNextAction({
        retailer,
        structureAssessment,
        codeSources: retailer.codeSources,
        dbCoverage,
      }),
    });
  }

  const blockedSources = retailers.flatMap((retailer) =>
    retailer.reachability.filter((row) => row.blockedLikely).map((row) => ({ retailerKey: retailer.retailerKey, url: row.url, status: row.status }))
  );
  const sourcesAlreadyActive = uniqueCompact(retailers.flatMap((retailer) =>
    retailer.codeSources.filter((source) => source.sourceKind === 'official' && source.active).map((source) => `${retailer.retailerKey}:${source.sourceKey}`)
  ));
  const sourcesPresentButDisabled = uniqueCompact(retailers.flatMap((retailer) =>
    retailer.codeSources.filter((source) => source.sourceKind === 'official' && !source.active).map((source) => `${retailer.retailerKey}:${source.sourceKey}`)
  ));
  const missingOfficialParsers = retailers
    .filter((retailer) => ['none', 'fixture-only'].includes(retailer.structureAssessment.existingParserCoverage))
    .map((retailer) => retailer.retailerKey);

  return {
    generatedAt: generatedAt instanceof Date ? generatedAt.toISOString() : generatedAt,
    readOnly: true,
    mutatedCollections: [],
    performanceSafe: true,
    reachabilityChecked: Boolean(checkUrls),
    summary: {
      retailerCount: retailers.length,
      officialUrlsChecked: checkUrls ? retailers.reduce((sum, retailer) => sum + retailer.officialUrls.length, 0) : 0,
      likelyBestNextTargets: retailers
        .filter((retailer) => ['partial', 'fixture-only', 'none'].includes(retailer.structureAssessment.existingParserCoverage))
        .slice(0, 5)
        .map((retailer) => retailer.retailerKey),
      blockedSources,
      sourcesAlreadyActive,
      sourcesPresentButDisabled,
      missingOfficialParsers,
    },
    retailers,
  };
}

module.exports = {
  DEFAULT_LIMIT,
  OFFICIAL_RETAILERS,
  assessExistingParserCoverage,
  assessRisks,
  assessStructure,
  buildCoverageRatios,
  buildOfficialSourceMatrix,
  checkOfficialUrl,
  classifySourceKind,
  deriveSourceKey,
  getRetailerConfigs,
  isBlockedLikely,
  normalizeCodeSource,
  pct,
  recommendNextAction,
};
