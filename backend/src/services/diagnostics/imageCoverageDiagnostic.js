const fs = require('node:fs/promises');
const path = require('node:path');
const axios = require('axios');

const { isUsableImageUrl } = require('../images/imageUrl');
const {
  buildOfferRanking,
  normalizeSearchText,
  tokenizeSearchText,
} = require('../offers/offerRankingService');
const { normalizeTitleForMatch } = require('../crawl/sourceEvidence');
const { deriveSourceKey } = require('../crawl/crawlSourceSelection');

const DEFAULT_RETAILERS = [
  'bipa',
  'dm',
  'spar',
  'eurospar',
  'interspar',
  'penny',
  'hofer',
  'lidl',
  'billa',
  'billa-plus',
];

const DEFAULT_QUERIES = [
  'duschgel',
  'bier',
  'kaffee',
  'butter',
  'waschmittel',
  'milka',
  'katzenfutter',
  'zahnpasta',
  'pizza',
  'milch',
];

const STRONGLY_AFFECTED_RETAILERS = ['bipa', 'dm', 'spar', 'eurospar', 'interspar', 'penny'];
const MAX_API_LIMIT = 500;
const DEFAULT_TOP_LIMIT = 20;
const DEFAULT_API_BASE_URL = 'https://www.kaufklug.at/api';

function compact(values = []) {
  return values.map((value) => String(value || '').trim()).filter(Boolean);
}

function unique(values = []) {
  return [...new Set(compact(values))];
}

function pct(part, total) {
  if (!total) return 0;
  return Number(((part / total) * 100).toFixed(1));
}

function buildActiveOfferMatch(now = new Date()) {
  return {
    $or: [
      { status: 'active', isActiveNow: true },
      { isActiveNow: true },
      { isActiveToday: true },
      {
        status: 'active',
        $or: [
          { validTo: { $gte: now } },
          { validTo: null },
        ],
      },
    ],
  };
}

function valuePresent(value) {
  if (Array.isArray(value)) return value.some(valuePresent);
  if (value && typeof value === 'object') return Object.values(value).some(valuePresent);
  return String(value || '').trim().length > 0;
}

function scanImageLikeFields(value, prefix = '', output = []) {
  if (!value || typeof value !== 'object' || output.length >= 20) {
    return output;
  }

  for (const [key, child] of Object.entries(value)) {
    if (output.length >= 20) break;
    const fieldPath = prefix ? `${prefix}.${key}` : key;
    const isImageKey = /(?:^|\.)(?:image|images|imageUrl|displayImage|thumbnail|sourceImageUrl|remoteImageUrl|asset)$/i.test(fieldPath)
      || /image/i.test(key)
      || /thumbnail/i.test(key);

    if (isImageKey && valuePresent(child)) {
      output.push({
        path: fieldPath,
        valueType: Array.isArray(child) ? 'array' : typeof child,
        usableUrl: typeof child === 'string' ? isUsableImageUrl(child) : false,
      });
    }

    if (child && typeof child === 'object') {
      scanImageLikeFields(child, fieldPath, output);
    }
  }

  return output;
}

function sourceKeyForOffer(offer = {}, source = {}) {
  return offer.sourceKey
    || offer.rawFacts?.sourceKey
    || offer.rawFacts?.sourceMetadata?.sourceKey
    || source.sourceKey
    || (source && Object.keys(source).length > 0 ? deriveSourceKey(source) : '')
    || offer.sourceType
    || offer.sourceUrl
    || 'unknown';
}

function sourceTypeForOffer(offer = {}, source = {}) {
  return offer.sourceType || offer.rawFacts?.sourceType || source.sourceType || 'unknown';
}

function channelForOffer(offer = {}, source = {}) {
  if (source.channel) return source.channel;
  const sourceType = sourceTypeForOffer(offer, source);
  if (/official|pdf|site|flyer|product-search|json/.test(sourceType)) return 'official';
  if (/aktionsfinder|marktguru|wogibtswas|aggregator/.test(sourceType)) return 'aggregator';
  return 'unknown';
}

function imageState(offer = {}) {
  const rawImageUrl = String(offer.imageUrl || '').trim();
  const imageLikeFields = scanImageLikeFields({
    imageUrl: offer.imageUrl,
    rawFacts: offer.rawFacts,
  });

  return {
    hasImageUrl: Boolean(rawImageUrl),
    usableImageUrl: isUsableImageUrl(rawImageUrl),
    imageLikeFieldCount: imageLikeFields.length,
    imageLikeFields,
  };
}

function offerText(offer = {}) {
  return compact([
    offer.title,
    offer.titleNormalized,
    offer.brand,
    offer.searchText,
    offer.categoryPrimary,
    offer.categorySecondary,
    offer.categoryKey,
    offer.subcategoryKey,
    offer.comparisonGroup,
    Array.isArray(offer.searchTokens) ? offer.searchTokens.join(' ') : '',
    offer.rawFacts?.sourceCategory,
    offer.rawFacts?.infoText,
  ]).join(' ');
}

function offerMatchesQuery(offer = {}, query = '') {
  const normalizedQuery = normalizeSearchText(query);
  const queryTokens = tokenizeSearchText(query);
  const searchTokenSet = new Set((offer.searchTokens || []).map((token) => normalizeSearchText(token)));

  if (queryTokens.some((token) => searchTokenSet.has(token))) {
    return true;
  }

  const normalizedText = normalizeSearchText(offerText(offer));
  const titleText = normalizeTitleForMatch(offerText(offer));
  return normalizedText.includes(normalizedQuery) || titleText.includes(normalizeTitleForMatch(query));
}

function incrementCoverage(map, key, offer) {
  const normalizedKey = String(key || 'unknown');
  const row = map.get(normalizedKey) || {
    key: normalizedKey,
    total: 0,
    withImage: 0,
    withoutImage: 0,
    usableImage: 0,
    imageLikeFieldsOnly: 0,
    invalidImageUrl: 0,
  };
  const state = imageState(offer);

  row.total += 1;
  if (state.hasImageUrl) row.withImage += 1;
  else row.withoutImage += 1;
  if (state.usableImageUrl) row.usableImage += 1;
  if (!state.hasImageUrl && state.imageLikeFieldCount > 0) row.imageLikeFieldsOnly += 1;
  if (state.hasImageUrl && !state.usableImageUrl) row.invalidImageUrl += 1;

  map.set(normalizedKey, row);
}

function finalizeCoverageRows(map) {
  return [...map.values()]
    .map((row) => ({
      ...row,
      imagePct: pct(row.withImage, row.total),
      usableImagePct: pct(row.usableImage, row.total),
    }))
    .sort((left, right) => right.total - left.total || left.key.localeCompare(right.key));
}

function priceAmount(offer = {}) {
  return offer.priceCurrent?.amount ?? null;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function groupIdentity(offer = {}) {
  return compact([
    offer.dedupeKey ? `dedupe:${offer.dedupeKey}` : '',
    offer.comparisonGroup ? `comparison:${offer.retailerKey}:${offer.comparisonGroup}:${priceAmount(offer) ?? ''}` : '',
    compact([
      offer.retailerKey,
      normalizeTitleForMatch(offer.title).split(' ').slice(0, 8).join('-'),
      String(priceAmount(offer) ?? ''),
      normalizeTitleForMatch(offer.quantityText || ''),
      formatDate(offer.validTo),
    ]).join(':'),
  ])[0] || String(offer._id || '');
}

function siblingStats(offer = {}, groupMap = new Map()) {
  const siblings = groupMap.get(groupIdentity(offer)) || [];
  const imageSiblings = siblings.filter((item) => String(item._id) !== String(offer._id) && imageState(item).hasImageUrl);

  return {
    groupId: groupIdentity(offer),
    siblingCount: Math.max(0, siblings.length - 1),
    siblingWithImageCount: imageSiblings.length,
    siblingSourceTypesWithImage: unique(imageSiblings.map((item) => item.sourceType)),
  };
}

function summarizeOffer(offer = {}, source = {}, groupMap = new Map(), apiOffer = null) {
  const state = imageState(offer);
  const apiImagePresent = apiOffer ? Boolean(String(apiOffer.imageUrl || '').trim()) : null;
  const sourceKey = sourceKeyForOffer(offer, source);
  const sourceType = sourceTypeForOffer(offer, source);
  const sibling = siblingStats(offer, groupMap);
  let causeGuess = 'source-or-parser-missing-image';

  if (state.hasImageUrl && !state.usableImageUrl) causeGuess = 'invalid-image-url';
  else if (!state.hasImageUrl && state.imageLikeFieldCount > 0) causeGuess = 'image-like-db-field-not-mapped-to-imageUrl';
  else if (apiOffer && state.hasImageUrl && !apiImagePresent) causeGuess = 'api-projection-missing-image';
  else if (!state.hasImageUrl && sibling.siblingWithImageCount > 0) causeGuess = 'dedupe-or-visible-winner-lost-sibling-image';
  else if (/pdf|flyer/i.test(`${sourceType} ${sourceKey}`) && !state.hasImageUrl) causeGuess = 'pdf-flyer-no-product-image';

  return {
    title: offer.title || '',
    retailerKey: offer.retailerKey || '',
    retailerName: offer.retailerName || '',
    sourceKey,
    sourceType,
    sourceChannel: channelForOffer(offer, source),
    categoryPrimary: offer.categoryPrimary || '',
    categorySecondary: offer.categorySecondary || '',
    price: priceAmount(offer),
    validFrom: formatDate(offer.validFrom),
    validTo: formatDate(offer.validTo),
    offerId: String(offer._id || offer.id || ''),
    imageFieldsPresent: state.hasImageUrl || state.imageLikeFieldCount > 0,
    imageUrlPresent: state.hasImageUrl,
    imageUrlUsableShape: state.usableImageUrl,
    imageLikeFields: state.imageLikeFields,
    apiImageFieldPresent: apiImagePresent,
    dedupeGroup: sibling.groupId,
    siblingCount: sibling.siblingCount,
    siblingWithImageCount: sibling.siblingWithImageCount,
    siblingSourceTypesWithImage: sibling.siblingSourceTypesWithImage,
    causeGuess,
  };
}

function buildGroupMap(offers = []) {
  const map = new Map();

  for (const offer of offers) {
    const key = groupIdentity(offer);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(offer);
  }

  return map;
}

function mapSources(sources = []) {
  return new Map(sources.map((source) => [String(source._id || source.id || ''), source]));
}

function sourceForOffer(offer = {}, sourceMap = new Map()) {
  return sourceMap.get(String(offer.sourceId || '')) || {};
}

function buildQueryApiMap(apiRows = []) {
  return new Map(apiRows.map((offer) => [String(offer.id || offer._id || ''), offer]));
}

function liveApiOfferText(offer = {}) {
  return compact([
    offer.title,
    offer.brand,
    offer.categoryPrimary,
    offer.categorySecondary,
    offer.displayCategory,
    offer.sourceKey,
    offer.sourceType,
  ]).join(' ');
}

function summarizeLiveApiOffer(offer = {}, query = '') {
  return {
    title: offer.title || '',
    retailerKey: offer.retailerKey || '',
    retailerName: offer.retailerName || '',
    sourceKey: offer.sourceKey || '',
    sourceType: offer.sourceType || '',
    categoryPrimary: offer.categoryPrimary || '',
    categorySecondary: offer.categorySecondary || offer.displayCategory || '',
    price: offer.priceCurrent?.amount ?? offer.price ?? null,
    validFrom: formatDate(offer.validFrom),
    validTo: formatDate(offer.validTo),
    offerId: String(offer.id || offer._id || ''),
    imageFieldsPresent: Boolean(String(offer.imageUrl || '').trim()),
    imageUrlPresent: Boolean(String(offer.imageUrl || '').trim()),
    imageUrlUsableShape: isUsableImageUrl(offer.imageUrl || ''),
    apiImageFieldPresent: Boolean(String(offer.imageUrl || '').trim()),
    dedupeGroup: offer.dedupeKey || offer.comparisonGroup || '',
    siblingCount: null,
    siblingWithImageCount: null,
    causeGuess: String(offer.imageUrl || '').trim()
      ? (isUsableImageUrl(offer.imageUrl) ? 'api-visible-image-present' : 'api-visible-image-url-invalid-shape')
      : (/pdf|flyer/i.test(`${offer.sourceType || ''} ${offer.sourceKey || ''}`)
          ? 'api-visible-pdf-or-flyer-result-without-image'
          : 'api-visible-result-without-image'),
    query,
  };
}

function incrementApiCoverage(map, key, offer) {
  const normalizedKey = String(key || 'unknown');
  const row = map.get(normalizedKey) || {
    key: normalizedKey,
    total: 0,
    withImage: 0,
    withoutImage: 0,
    usableImage: 0,
    invalidImageUrl: 0,
  };
  const hasImage = Boolean(String(offer.imageUrl || '').trim());

  row.total += 1;
  if (hasImage) row.withImage += 1;
  else row.withoutImage += 1;
  if (isUsableImageUrl(offer.imageUrl || '')) row.usableImage += 1;
  if (hasImage && !isUsableImageUrl(offer.imageUrl || '')) row.invalidImageUrl += 1;

  map.set(normalizedKey, row);
}

function finalizeApiCoverageRows(map) {
  return [...map.values()]
    .map((row) => ({
      ...row,
      imagePct: pct(row.withImage, row.total),
      usableImagePct: pct(row.usableImage, row.total),
    }))
    .sort((left, right) => right.total - left.total || left.key.localeCompare(right.key));
}

async function fetchLiveRanking({ apiBaseUrl, query, retailers = [], limit = MAX_API_LIMIT }) {
  if (!apiBaseUrl) {
    return { ok: false, skipped: true, rankedOffers: [], message: 'api-base-url-disabled' };
  }

  try {
    const response = await axios.get(`${apiBaseUrl.replace(/\/+$/, '')}/offers/ranking`, {
      timeout: 15000,
      params: {
        q: query,
        retailers: retailers.join(','),
        limit,
      },
      validateStatus: () => true,
    });

    if (response.status < 200 || response.status >= 300) {
      return { ok: false, skipped: false, rankedOffers: [], status: response.status, message: 'non-2xx-api-response' };
    }

    return {
      ok: true,
      skipped: false,
      status: response.status,
      rankedOffers: Array.isArray(response.data?.rankedOffers) ? response.data.rankedOffers : [],
      summary: response.data?.summary || {},
    };
  } catch (error) {
    return { ok: false, skipped: false, rankedOffers: [], message: error.message };
  }
}

async function buildLiveApiOnlyImageCoverageDiagnostic({
  retailers = DEFAULT_RETAILERS,
  queries = DEFAULT_QUERIES,
  topLimit = DEFAULT_TOP_LIMIT,
  apiBaseUrl = DEFAULT_API_BASE_URL,
  writeReports = false,
  outputDir = path.resolve(process.cwd(), 'tmp'),
} = {}) {
  const byRetailer = new Map();
  const bySource = new Map();
  const bySourceType = new Map();
  const byRetailerQuery = new Map();
  const byQuery = [];
  const allRowsById = new Map();
  const missingByQuery = {};
  const apiChecks = [];

  for (const retailerKey of retailers) {
    const result = await fetchLiveRanking({
      apiBaseUrl,
      query: '',
      retailers: [retailerKey],
      limit: MAX_API_LIMIT,
    });
    apiChecks.push({
      scope: `retailer:${retailerKey}`,
      ok: result.ok,
      skipped: result.skipped,
      total: result.rankedOffers.length,
      withImage: result.rankedOffers.filter((offer) => String(offer.imageUrl || '').trim()).length,
      status: result.status || null,
      message: result.message || '',
    });

    for (const offer of result.rankedOffers) {
      allRowsById.set(String(offer.id || offer._id || `${retailerKey}:${offer.title}`), offer);
      incrementApiCoverage(byRetailer, offer.retailerKey || retailerKey, offer);
      incrementApiCoverage(bySource, offer.sourceKey || offer.sourceType || 'unknown', offer);
      incrementApiCoverage(bySourceType, offer.sourceType || 'unknown', offer);
    }
  }

  for (const query of queries) {
    const result = await fetchLiveRanking({
      apiBaseUrl,
      query,
      retailers: [],
      limit: MAX_API_LIMIT,
    });
    const rankedOffers = result.rankedOffers || [];

    apiChecks.push({
      scope: `query:${query}`,
      ok: result.ok,
      skipped: result.skipped,
      total: rankedOffers.length,
      withImage: rankedOffers.filter((offer) => String(offer.imageUrl || '').trim()).length,
      status: result.status || null,
      message: result.message || '',
    });

    const queryRetailers = new Map();
    for (const offer of rankedOffers) {
      allRowsById.set(String(offer.id || offer._id || `${query}:${offer.retailerKey}:${offer.title}`), offer);
      incrementApiCoverage(queryRetailers, offer.retailerKey || 'unknown', offer);
      incrementApiCoverage(byRetailerQuery, `${offer.retailerKey || 'unknown'}|${query}`, offer);
      incrementApiCoverage(bySource, offer.sourceKey || offer.sourceType || 'unknown', offer);
      incrementApiCoverage(bySourceType, offer.sourceType || 'unknown', offer);
    }

    byQuery.push({
      query,
      dbTotal: null,
      dbWithImage: null,
      dbWithoutImage: null,
      dbImagePct: null,
      dbByRetailer: finalizeApiCoverageRows(queryRetailers),
      localApiTotal: null,
      localApiWithImage: null,
      localApiImagePct: null,
      liveApiTotal: rankedOffers.length,
      liveApiWithImage: rankedOffers.filter((offer) => String(offer.imageUrl || '').trim()).length,
      liveApiImagePct: pct(rankedOffers.filter((offer) => String(offer.imageUrl || '').trim()).length, rankedOffers.length),
      localVisibleDedupeCollapsed: null,
    });

    missingByQuery[`missing-${query}`] = rankedOffers
      .filter((offer) => !String(offer.imageUrl || '').trim())
      .slice(0, topLimit)
      .map((offer) => summarizeLiveApiOffer(offer, query));
  }

  const allRows = [...allRowsById.values()];
  const examples = {
    ...missingByQuery,
    'missing-strongly-affected-retailers': allRows
      .filter((offer) => STRONGLY_AFFECTED_RETAILERS.includes(offer.retailerKey))
      .filter((offer) => !String(offer.imageUrl || '').trim())
      .slice(0, topLimit)
      .map((offer) => summarizeLiveApiOffer(offer, 'all')),
    'invalid-image-url-shape': allRows
      .filter((offer) => String(offer.imageUrl || '').trim() && !isUsableImageUrl(offer.imageUrl))
      .slice(0, topLimit)
      .map((offer) => summarizeLiveApiOffer(offer, 'all')),
  };

  const byRetailerRows = finalizeApiCoverageRows(byRetailer).map((row) => ({
    ...row,
    imageLikeFieldsOnly: null,
    missingWithSiblingImage: null,
  }));
  const byRetailerQueryRows = finalizeApiCoverageRows(byRetailerQuery).map((row) => {
    const [retailerKey, query] = row.key.split('|');
    return { ...row, retailerKey, query };
  });
  const allExampleRows = Object.values(examples).flat();
  const report = {
    ok: true,
    partial: true,
    readOnly: true,
    crawlStarted: false,
    mutatedCollections: [],
    generatedAt: new Date().toISOString(),
    blocked: {
      db: true,
      dbReason: 'MongoDB connection unavailable in this environment; likely Atlas IP whitelist.',
      unavailableMetrics: [
        'all active DB offers',
        'DB image-like fields not projected to API',
        'storage dedupe source siblings',
        'rawFacts image field scan',
      ],
    },
    scope: {
      retailers,
      queries,
      apiBaseUrl,
    },
    summary: {
      total: allRows.length,
      withImage: allRows.filter((offer) => String(offer.imageUrl || '').trim()).length,
      withoutImage: allRows.filter((offer) => !String(offer.imageUrl || '').trim()).length,
      imagePct: pct(allRows.filter((offer) => String(offer.imageUrl || '').trim()).length, allRows.length),
      usableImage: allRows.filter((offer) => isUsableImageUrl(offer.imageUrl || '')).length,
      invalidImageUrl: allRows.filter((offer) => String(offer.imageUrl || '').trim() && !isUsableImageUrl(offer.imageUrl)).length,
      imageLikeFieldsOnly: null,
      missingWithSiblingImage: null,
      dbImageButLocalApiMissing: null,
      liveApiImageButDbMissing: null,
    },
    coverage: {
      byRetailer: byRetailerRows,
      bySource: finalizeApiCoverageRows(bySource),
      bySourceType: finalizeApiCoverageRows(bySourceType),
      byQuery,
      byRetailerQuery: byRetailerQueryRows,
    },
    apiChecks: {
      liveRankingByScope: apiChecks,
    },
    examples,
    causeCounts: summarizeCauseCounts(allExampleRows),
    method: {
      mode: 'live-api-only',
      apiImageField: 'rankedOffers[].imageUrl',
      frontendImageDecision: 'ProductImage uses /api/offers/:offerId/image first when offer.id and imageUrl exist, then direct imageUrl, otherwise placeholder.',
      imageUrlValidation: 'Shape validation only, no mass image downloads.',
    },
  };

  if (writeReports) {
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(path.join(outputDir, 'image-coverage-summary.json'), `${JSON.stringify({
      ok: report.ok,
      partial: report.partial,
      generatedAt: report.generatedAt,
      blocked: report.blocked,
      scope: report.scope,
      summary: report.summary,
      coverage: report.coverage,
      apiChecks: report.apiChecks,
      causeCounts: report.causeCounts,
      method: report.method,
    }, null, 2)}\n`);
    await fs.writeFile(path.join(outputDir, 'image-coverage-missing-examples.json'), `${JSON.stringify(report.examples, null, 2)}\n`);
    await fs.writeFile(path.join(outputDir, 'image-coverage-report.md'), buildReportMarkdown(report));
  }

  return report;
}

async function buildLocalRanking({ query, retailers = [], limit = MAX_API_LIMIT }) {
  try {
    const result = await buildOfferRanking({
      query,
      retailers: retailers.join(','),
      limit,
      diagnostics: true,
      debugCandidates: true,
    });

    return {
      ok: true,
      rankedOffers: result.response?.rankedOffers || [],
      summary: result.response?.summary || {},
      visibleDedupe: result.diagnostics?.candidates?.visibleDedupe || null,
      stages: result.diagnostics?.candidates?.stages || [],
    };
  } catch (error) {
    return {
      ok: false,
      rankedOffers: [],
      summary: {},
      visibleDedupe: null,
      stages: [],
      message: error.message,
    };
  }
}

function summarizeCauseCounts(examples = []) {
  const counts = new Map();

  for (const example of examples) {
    counts.set(example.causeGuess, (counts.get(example.causeGuess) || 0) + 1);
  }

  return [...counts.entries()]
    .map(([cause, count]) => ({ cause, count }))
    .sort((left, right) => right.count - left.count || left.cause.localeCompare(right.cause));
}

function pickTopMissing(offers, sourceMap, groupMap, apiById = new Map(), predicate = () => true, limit = DEFAULT_TOP_LIMIT) {
  return offers
    .filter((offer) => predicate(offer))
    .filter((offer) => !imageState(offer).hasImageUrl)
    .sort((left, right) =>
      Number(Boolean(right.isActiveNow)) - Number(Boolean(left.isActiveNow))
      || Number(right.sortScoreDefault || 0) - Number(left.sortScoreDefault || 0)
      || new Date(right.lastSeenAt || right.updatedAt || 0).getTime() - new Date(left.lastSeenAt || left.updatedAt || 0).getTime()
    )
    .slice(0, limit)
    .map((offer) => summarizeOffer(offer, sourceForOffer(offer, sourceMap), groupMap, apiById.get(String(offer._id))));
}

function buildReportMarkdown(report) {
  const lines = [];
  lines.push(`# Image Coverage Diagnostic`);
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Read-only: ${report.readOnly}; crawlStarted: ${report.crawlStarted}; mutatedCollections: ${report.mutatedCollections.length}`);
  lines.push('');
  lines.push(`## Gesamt`);
  lines.push(`- Aktive/relevante Offers: ${report.summary.total}`);
  lines.push(`- Mit imageUrl: ${report.summary.withImage} (${report.summary.imagePct}%)`);
  lines.push(`- Ohne imageUrl: ${report.summary.withoutImage} (${pct(report.summary.withoutImage, report.summary.total)}%)`);
  lines.push(`- Ungueltige imageUrl-Form: ${report.summary.invalidImageUrl}`);
  lines.push(`- DB hat Bild-aehnliche Felder, aber kein imageUrl: ${report.summary.imageLikeFieldsOnly}`);
  lines.push(`- Ohne Bild mit moeglichem Sibling-Bild: ${report.summary.missingWithSiblingImage}`);
  lines.push(`- DB imageUrl vorhanden, API lokal ohne imageUrl: ${report.summary.dbImageButLocalApiMissing}`);
  lines.push(`- Live-API imageUrl vorhanden, lokale DB ohne imageUrl: ${report.summary.liveApiImageButDbMissing}`);
  lines.push('');
  lines.push(`## Haendler`);
  lines.push(`retailer | total | withImage | withoutImage | imagePct | invalidUrl | imageLikeOnly | siblingImage`);
  lines.push(`--- | ---: | ---: | ---: | ---: | ---: | ---: | ---:`);
  for (const row of report.coverage.byRetailer) {
    lines.push(`${row.key} | ${row.total} | ${row.withImage} | ${row.withoutImage} | ${row.imagePct}% | ${row.invalidImageUrl} | ${row.imageLikeFieldsOnly} | ${row.missingWithSiblingImage || 0}`);
  }
  lines.push('');
  lines.push(`## Source / Source-Type`);
  lines.push(`source | total | withImage | imagePct | invalidUrl | imageLikeOnly`);
  lines.push(`--- | ---: | ---: | ---: | ---: | ---:`);
  for (const row of report.coverage.bySource.slice(0, 50)) {
    lines.push(`${row.key} | ${row.total} | ${row.withImage} | ${row.imagePct}% | ${row.invalidImageUrl} | ${row.imageLikeFieldsOnly}`);
  }
  lines.push('');
  lines.push(`## Suchbegriffe`);
  lines.push(`query | dbTotal | dbWithImage | dbImagePct | localApiTotal | localApiWithImage | liveApiTotal | liveApiWithImage`);
  lines.push(`--- | ---: | ---: | ---: | ---: | ---: | ---: | ---:`);
  for (const row of report.coverage.byQuery) {
    lines.push(`${row.query} | ${row.dbTotal} | ${row.dbWithImage} | ${row.dbImagePct}% | ${row.localApiTotal} | ${row.localApiWithImage} | ${row.liveApiTotal} | ${row.liveApiWithImage}`);
  }
  lines.push('');
  lines.push(`## Ursachenzaehlung Aus Beispielen`);
  for (const row of report.causeCounts) {
    lines.push(`- ${row.cause}: ${row.count}`);
  }
  lines.push('');
  lines.push(`## Auffaellige Beispiele`);
  for (const [label, examples] of Object.entries(report.examples)) {
    lines.push(`### ${label}`);
    for (const item of examples.slice(0, 20)) {
      lines.push(`- ${item.title} [${item.retailerKey}] source=${item.sourceKey}/${item.sourceType} price=${item.price ?? '-'} id=${item.offerId} cause=${item.causeGuess}`);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

async function buildImageCoverageDiagnostic({
  Offer,
  Source,
  retailers = DEFAULT_RETAILERS,
  queries = DEFAULT_QUERIES,
  topLimit = DEFAULT_TOP_LIMIT,
  apiBaseUrl = DEFAULT_API_BASE_URL,
  includeLiveApi = true,
  writeReports = false,
  outputDir = path.resolve(process.cwd(), 'tmp'),
} = {}) {
  const now = new Date();
  const activeMatch = buildActiveOfferMatch(now);
  const retailerFilter = retailers.length > 0 ? { retailerKey: { $in: retailers } } : {};
  const projection = [
    '_id',
    'retailerKey',
    'retailerName',
    'sourceId',
    'sourceType',
    'sourceUrl',
    'sourceUrls',
    'sourceTypes',
    'title',
    'titleNormalized',
    'brand',
    'searchText',
    'searchTokens',
    'categoryPrimary',
    'categorySecondary',
    'categoryKey',
    'subcategoryKey',
    'priceCurrent',
    'validFrom',
    'validTo',
    'isActiveNow',
    'isActiveToday',
    'status',
    'quantityText',
    'comparisonGroup',
    'dedupeKey',
    'offerKey',
    'imageUrl',
    'sortScoreDefault',
    'lastSeenAt',
    'updatedAt',
    'rawFacts',
  ].join(' ');

  const [offers, sources] = await Promise.all([
    Offer.find({ ...retailerFilter, ...activeMatch }).select(projection).lean(),
    Source.find(retailerFilter).select('_id retailerKey retailerName channel label sourceUrl sourceType parserHint parserVersion latestStatus latestRunAt sourceRetailerFormat').lean(),
  ]);
  const sourceMap = mapSources(sources);
  const groupMap = buildGroupMap(offers);
  const byRetailer = new Map();
  const bySource = new Map();
  const bySourceType = new Map();
  const byRetailerQuery = new Map();
  const apiById = new Map();
  const localApiByQuery = [];
  const liveApiByQuery = [];

  for (const offer of offers) {
    const source = sourceForOffer(offer, sourceMap);
    incrementCoverage(byRetailer, offer.retailerKey || 'unknown', offer);
    incrementCoverage(bySource, sourceKeyForOffer(offer, source), offer);
    incrementCoverage(bySourceType, sourceTypeForOffer(offer, source), offer);
  }

  const byQuery = [];
  for (const query of queries) {
    const dbMatches = offers.filter((offer) => offerMatchesQuery(offer, query));
    const localApi = await buildLocalRanking({ query, retailers, limit: MAX_API_LIMIT });
    const liveApi = includeLiveApi ? await fetchLiveRanking({ apiBaseUrl, query, retailers, limit: MAX_API_LIMIT }) : { ok: false, skipped: true, rankedOffers: [] };

    localApi.rankedOffers.forEach((offer) => apiById.set(String(offer.id || offer._id || ''), offer));

    const queryRetailerRows = new Map();
    for (const offer of dbMatches) {
      incrementCoverage(queryRetailerRows, offer.retailerKey || 'unknown', offer);
      incrementCoverage(byRetailerQuery, `${offer.retailerKey || 'unknown'}|${query}`, offer);
    }

    localApiByQuery.push({
      query,
      ok: localApi.ok,
      total: localApi.rankedOffers.length,
      withImage: localApi.rankedOffers.filter((offer) => String(offer.imageUrl || '').trim()).length,
      visibleDedupe: localApi.visibleDedupe,
      message: localApi.message || '',
    });
    liveApiByQuery.push({
      query,
      ok: liveApi.ok,
      skipped: liveApi.skipped,
      total: liveApi.rankedOffers.length,
      withImage: liveApi.rankedOffers.filter((offer) => String(offer.imageUrl || '').trim()).length,
      status: liveApi.status || null,
      message: liveApi.message || '',
    });

    byQuery.push({
      query,
      dbTotal: dbMatches.length,
      dbWithImage: dbMatches.filter((offer) => imageState(offer).hasImageUrl).length,
      dbWithoutImage: dbMatches.filter((offer) => !imageState(offer).hasImageUrl).length,
      dbImagePct: pct(dbMatches.filter((offer) => imageState(offer).hasImageUrl).length, dbMatches.length),
      dbByRetailer: finalizeCoverageRows(queryRetailerRows),
      localApiTotal: localApi.rankedOffers.length,
      localApiWithImage: localApi.rankedOffers.filter((offer) => String(offer.imageUrl || '').trim()).length,
      localApiImagePct: pct(localApi.rankedOffers.filter((offer) => String(offer.imageUrl || '').trim()).length, localApi.rankedOffers.length),
      liveApiTotal: liveApi.rankedOffers.length,
      liveApiWithImage: liveApi.rankedOffers.filter((offer) => String(offer.imageUrl || '').trim()).length,
      liveApiImagePct: pct(liveApi.rankedOffers.filter((offer) => String(offer.imageUrl || '').trim()).length, liveApi.rankedOffers.length),
      localVisibleDedupeCollapsed: localApi.visibleDedupe?.secondStageCollapsedCount || 0,
    });
  }

  const dbImageButLocalApiMissing = [];
  const liveApiImageButDbMissing = [];
  for (const offer of offers) {
    const apiOffer = apiById.get(String(offer._id));
    if (imageState(offer).hasImageUrl && apiOffer && !String(apiOffer.imageUrl || '').trim()) {
      dbImageButLocalApiMissing.push(summarizeOffer(offer, sourceForOffer(offer, sourceMap), groupMap, apiOffer));
    }
  }

  for (const liveQuery of liveApiByQuery) {
    if (!liveQuery.ok) continue;
  }

  const byRetailerRows = finalizeCoverageRows(byRetailer).map((row) => {
    const missingWithSiblingImage = offers.filter((offer) =>
      offer.retailerKey === row.key
      && !imageState(offer).hasImageUrl
      && siblingStats(offer, groupMap).siblingWithImageCount > 0
    ).length;

    return { ...row, missingWithSiblingImage };
  });
  const bySourceRows = finalizeCoverageRows(bySource);
  const bySourceTypeRows = finalizeCoverageRows(bySourceType);
  const byRetailerQueryRows = finalizeCoverageRows(byRetailerQuery)
    .map((row) => {
      const [retailerKey, query] = row.key.split('|');
      return { ...row, retailerKey, query };
    });

  const missingExamples = {};
  for (const retailerKey of STRONGLY_AFFECTED_RETAILERS) {
    missingExamples[`missing-${retailerKey}`] = pickTopMissing(
      offers,
      sourceMap,
      groupMap,
      apiById,
      (offer) => offer.retailerKey === retailerKey,
      topLimit
    );
  }

  missingExamples['missing-duschgel'] = pickTopMissing(
    offers,
    sourceMap,
    groupMap,
    apiById,
    (offer) => offerMatchesQuery(offer, 'duschgel'),
    topLimit
  );
  missingExamples['missing-bier'] = pickTopMissing(
    offers,
    sourceMap,
    groupMap,
    apiById,
    (offer) => offerMatchesQuery(offer, 'bier'),
    topLimit
  );
  missingExamples['dedupe-sibling-with-image'] = offers
    .filter((offer) => !imageState(offer).hasImageUrl && siblingStats(offer, groupMap).siblingWithImageCount > 0)
    .slice(0, topLimit)
    .map((offer) => summarizeOffer(offer, sourceForOffer(offer, sourceMap), groupMap, apiById.get(String(offer._id))));
  missingExamples['db-image-api-missing'] = dbImageButLocalApiMissing.slice(0, topLimit);
  missingExamples['invalid-image-url-shape'] = offers
    .filter((offer) => imageState(offer).hasImageUrl && !imageState(offer).usableImageUrl)
    .slice(0, topLimit)
    .map((offer) => summarizeOffer(offer, sourceForOffer(offer, sourceMap), groupMap, apiById.get(String(offer._id))));

  const allExampleRows = Object.values(missingExamples).flat();
  const missingWithSiblingImage = offers.filter((offer) =>
    !imageState(offer).hasImageUrl && siblingStats(offer, groupMap).siblingWithImageCount > 0
  ).length;
  const imageLikeFieldsOnly = offers.filter((offer) => {
    const state = imageState(offer);
    return !state.hasImageUrl && state.imageLikeFieldCount > 0;
  }).length;
  const invalidImageUrl = offers.filter((offer) => {
    const state = imageState(offer);
    return state.hasImageUrl && !state.usableImageUrl;
  }).length;

  const report = {
    ok: true,
    readOnly: true,
    crawlStarted: false,
    mutatedCollections: [],
    generatedAt: new Date().toISOString(),
    scope: {
      retailers,
      queries,
      apiBaseUrl: includeLiveApi ? apiBaseUrl : '',
    },
    summary: {
      total: offers.length,
      withImage: offers.filter((offer) => imageState(offer).hasImageUrl).length,
      withoutImage: offers.filter((offer) => !imageState(offer).hasImageUrl).length,
      imagePct: pct(offers.filter((offer) => imageState(offer).hasImageUrl).length, offers.length),
      usableImage: offers.filter((offer) => imageState(offer).usableImageUrl).length,
      invalidImageUrl,
      imageLikeFieldsOnly,
      missingWithSiblingImage,
      dbImageButLocalApiMissing: dbImageButLocalApiMissing.length,
      liveApiImageButDbMissing: liveApiImageButDbMissing.length,
    },
    coverage: {
      byRetailer: byRetailerRows,
      bySource: bySourceRows,
      bySourceType: bySourceTypeRows,
      byQuery,
      byRetailerQuery: byRetailerQueryRows,
    },
    apiChecks: {
      localRankingByQuery: localApiByQuery,
      liveRankingByQuery: liveApiByQuery,
    },
    examples: missingExamples,
    causeCounts: summarizeCauseCounts(allExampleRows),
    method: {
      dbImageField: 'Offer.imageUrl',
      apiImageField: 'rankedOffers[].imageUrl',
      frontendImageDecision: 'ProductImage uses /api/offers/:offerId/image first when offer.id and imageUrl exist, then direct imageUrl, otherwise placeholder.',
      imageUrlValidation: 'Shape validation only, no mass image downloads.',
    },
  };

  if (writeReports) {
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(path.join(outputDir, 'image-coverage-summary.json'), `${JSON.stringify({
      ok: report.ok,
      generatedAt: report.generatedAt,
      scope: report.scope,
      summary: report.summary,
      coverage: report.coverage,
      apiChecks: report.apiChecks,
      causeCounts: report.causeCounts,
      method: report.method,
    }, null, 2)}\n`);
    await fs.writeFile(path.join(outputDir, 'image-coverage-missing-examples.json'), `${JSON.stringify(report.examples, null, 2)}\n`);
    await fs.writeFile(path.join(outputDir, 'image-coverage-report.md'), buildReportMarkdown(report));
  }

  return report;
}

function parseArgs(argv = []) {
  const options = {
    retailers: DEFAULT_RETAILERS,
    queries: DEFAULT_QUERIES,
    topLimit: DEFAULT_TOP_LIMIT,
    apiBaseUrl: DEFAULT_API_BASE_URL,
    includeLiveApi: true,
    writeReports: true,
    json: false,
    outputDir: path.resolve(process.cwd(), 'tmp'),
    apiOnly: false,
  };

  for (const arg of argv) {
    if (arg === '--json') options.json = true;
    if (arg === '--api-only') options.apiOnly = true;
    if (arg === '--no-live-api') options.includeLiveApi = false;
    if (arg === '--no-write') options.writeReports = false;
    if (arg.startsWith('--api-base-url=')) options.apiBaseUrl = arg.slice('--api-base-url='.length).replace(/\/+$/, '');
    if (arg.startsWith('--output-dir=')) options.outputDir = path.resolve(process.cwd(), arg.slice('--output-dir='.length));
    if (arg.startsWith('--retailers=')) options.retailers = unique(arg.slice('--retailers='.length).split(','));
    if (arg.startsWith('--queries=')) options.queries = unique(arg.slice('--queries='.length).split(','));
    if (arg.startsWith('--top-limit=')) {
      const value = Number(arg.slice('--top-limit='.length));
      if (Number.isInteger(value) && value > 0 && value <= 100) options.topLimit = value;
    }
  }

  return options;
}

module.exports = {
  DEFAULT_QUERIES,
  DEFAULT_RETAILERS,
  buildActiveOfferMatch,
  buildImageCoverageDiagnostic,
  buildLiveApiOnlyImageCoverageDiagnostic,
  buildReportMarkdown,
  imageState,
  offerMatchesQuery,
  parseArgs,
  summarizeOffer,
};
