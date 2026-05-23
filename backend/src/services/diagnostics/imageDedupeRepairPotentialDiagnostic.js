const fs = require('node:fs/promises');
const path = require('node:path');

const { _private: catalogDeduperPrivate } = require('../crawl/catalogDeduper');
const { deriveSourceKey } = require('../crawl/crawlSourceSelection');
const {
  DEFAULT_QUERIES,
  DEFAULT_RETAILERS,
  buildActiveOfferMatch,
  offerMatchesQuery,
} = require('./imageCoverageDiagnostic');

const TARGET_RETAILERS = [
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
  'adeg',
];

const CHANNEL_PRIORITY = {
  'official-flyer': 0,
  'official-site': 1,
  aggregator: 2,
  other: 3,
};

function compact(values = []) {
  return values.map((value) => String(value || '').trim()).filter(Boolean);
}

function inc(map, key, amount = 1) {
  const normalizedKey = String(key || 'unknown');
  map.set(normalizedKey, (map.get(normalizedKey) || 0) + amount);
}

function mapRows(map) {
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

function sourceForOffer(offer = {}, sourceMap = new Map()) {
  return sourceMap.get(String(offer.sourceId || '')) || {};
}

function sourceKeyForOffer(offer = {}, sourceMap = new Map()) {
  const source = sourceForOffer(offer, sourceMap);

  return offer.sourceKey
    || offer.rawFacts?.sourceKey
    || offer.rawFacts?.sourceMetadata?.sourceKey
    || source.sourceKey
    || (Object.keys(source).length > 0 ? deriveSourceKey(source) : '')
    || offer.sourceType
    || offer.sourceUrl
    || 'unknown';
}

function sourceTypeForOffer(offer = {}, sourceMap = new Map()) {
  const source = sourceForOffer(offer, sourceMap);
  return offer.sourceType || offer.rawFacts?.sourceType || source.sourceType || 'unknown';
}

function normalizedRetailerKey(offer = {}) {
  const retailerKey = String(offer.retailerKey || '').toLowerCase();
  const format = compact([
    offer.sourceRetailerFormat,
    offer.retailerFormatLabel,
    ...(Array.isArray(offer.appliesToRetailerFormats) ? offer.appliesToRetailerFormats : []),
    ...(Array.isArray(offer.retailerFormats) ? offer.retailerFormats : []),
    offer.retailerName,
    offer.sourceRetailerName,
  ]).join(' ').toLowerCase();

  if (retailerKey === 'spar' && /interspar/.test(format)) return 'interspar';
  if (retailerKey === 'spar' && /eurospar/.test(format)) return 'eurospar';

  return retailerKey || 'unknown';
}

function getPriority(source) {
  return CHANNEL_PRIORITY[source?.channel] ?? 99;
}

function getOfferCompletenessScore(offer) {
  return Number(offer?.quality?.completenessScore || 0);
}

function getOfferConfidence(offer) {
  return Number(offer?.quality?.parsingConfidence || 0);
}

function getStructuredFieldScore(offer) {
  const candidates = [
    offer?.offerKey,
    offer?.dedupeKey,
    offer?.titleNormalized,
    offer?.categoryKey,
    offer?.comparisonGroup,
    offer?.packCount,
    offer?.unitValue,
    offer?.unitType,
    offer?.totalComparableAmount,
    offer?.comparableUnit,
    offer?.packageType,
    offer?.effectiveDiscountType,
    offer?.minimumPurchaseQty,
    offer?.status,
    offer?.searchText,
    offer?.sortScoreDefault,
  ];

  return candidates.filter((value) => value !== null && value !== undefined && value !== '').length;
}

function compareOffersForCanonical(left, right, sourceMap) {
  const leftActive = Number(Boolean(left?.isActiveNow));
  const rightActive = Number(Boolean(right?.isActiveNow));

  if (rightActive !== leftActive) return rightActive - leftActive;

  const leftSafe = Number(Boolean(left?.quality?.comparisonSafe));
  const rightSafe = Number(Boolean(right?.quality?.comparisonSafe));

  if (rightSafe !== leftSafe) return rightSafe - leftSafe;

  const leftCompleteness = getOfferCompletenessScore(left);
  const rightCompleteness = getOfferCompletenessScore(right);

  if (rightCompleteness !== leftCompleteness) return rightCompleteness - leftCompleteness;

  const leftConfidence = getOfferConfidence(left);
  const rightConfidence = getOfferConfidence(right);

  if (rightConfidence !== leftConfidence) return rightConfidence - leftConfidence;

  const leftStructured = getStructuredFieldScore(left);
  const rightStructured = getStructuredFieldScore(right);

  if (rightStructured !== leftStructured) return rightStructured - leftStructured;

  const leftPriority = getPriority(sourceMap.get(String(left.sourceId)));
  const rightPriority = getPriority(sourceMap.get(String(right.sourceId)));

  if (leftPriority !== rightPriority) return leftPriority - rightPriority;

  return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
}

function imageDomainOrShortUrl(value = '') {
  const imageUrl = String(value || '').trim();

  try {
    const parsed = new URL(imageUrl);
    const shortPath = parsed.pathname.length > 48 ? `${parsed.pathname.slice(0, 45)}...` : parsed.pathname;
    return `${parsed.hostname}${shortPath}`;
  } catch (error) {
    return imageUrl.length > 60 ? `${imageUrl.slice(0, 57)}...` : imageUrl;
  }
}

function priceText(offer = {}) {
  const amount = offer.priceCurrent?.amount;
  const currency = offer.priceCurrent?.currency || 'EUR';
  return Number.isFinite(Number(amount)) ? `${Number(amount).toFixed(2)} ${currency}` : '';
}

function shortFingerprint(value = '') {
  const text = String(value || '');
  return text.length > 220 ? `${text.slice(0, 217)}...` : text;
}

function summarizeExample({ canonical, sibling, dedupeKey, sourceMap }) {
  return {
    canonicalOfferId: String(canonical._id || ''),
    title: canonical.title || '',
    retailerKey: normalizedRetailerKey(canonical),
    canonicalSourceKey: sourceKeyForOffer(canonical, sourceMap),
    canonicalSourceType: sourceTypeForOffer(canonical, sourceMap),
    price: priceText(canonical),
    category: compact([canonical.categoryPrimary, canonical.categorySecondary]).join(' > '),
    canonicalImageUrl: '',
    siblingOfferId: String(sibling._id || ''),
    siblingSourceKey: sourceKeyForOffer(sibling, sourceMap),
    siblingSourceType: sourceTypeForOffer(sibling, sourceMap),
    siblingImageUrlShort: imageDomainOrShortUrl(sibling.imageUrl),
    dedupeKey: shortFingerprint(dedupeKey),
    safeMergeReason: 'same catalogDeduper dedupe key; canonical selected by catalogDeduper ordering; sibling imageUrl passes preservable URL validation',
  };
}

function buildImageDedupeRepairPotentialDiagnostic({
  offers = [],
  sources = [],
  generatedAt = new Date(),
  queries = DEFAULT_QUERIES,
} = {}) {
  const sourceMap = new Map(sources.map((source) => [String(source._id), source]));
  const groups = new Map();

  for (const offer of offers) {
    const dedupeKey = catalogDeduperPrivate.buildDedupeKey(offer);

    if (!groups.has(dedupeKey)) groups.set(dedupeKey, []);
    groups.get(dedupeKey).push(offer);
  }

  const byRetailer = new Map();
  const byCanonicalSourceKey = new Map();
  const byCanonicalSourceType = new Map();
  const bySiblingImageSourceKey = new Map();
  const bySiblingImageSourceType = new Map();
  const byQuery = new Map(queries.map((query) => [query, 0]));
  const examples = [];
  const queryExamples = Object.fromEntries(queries.map((query) => [query, []]));
  let safeDuplicateGroups = 0;
  let canonicalWithoutImageGroups = 0;
  let potentialRepairableGroups = 0;
  let duplicateGroupCanonicalImageGapsWithoutSiblingImage = 0;

  for (const [dedupeKey, groupOffers] of groups.entries()) {
    if (groupOffers.length <= 1) continue;

    safeDuplicateGroups += 1;

    const sorted = [...groupOffers].sort((left, right) => compareOffersForCanonical(left, right, sourceMap));
    const canonical = sorted[0];

    if (catalogDeduperPrivate.isPreservableImageUrl(canonical.imageUrl)) continue;

    canonicalWithoutImageGroups += 1;

    const imageSibling = sorted
      .slice(1)
      .find((offer) => catalogDeduperPrivate.isPreservableImageUrl(offer?.imageUrl));

    if (!imageSibling) {
      duplicateGroupCanonicalImageGapsWithoutSiblingImage += 1;
      continue;
    }

    potentialRepairableGroups += 1;
    inc(byRetailer, normalizedRetailerKey(canonical));
    inc(byCanonicalSourceKey, sourceKeyForOffer(canonical, sourceMap));
    inc(byCanonicalSourceType, sourceTypeForOffer(canonical, sourceMap));
    inc(bySiblingImageSourceKey, sourceKeyForOffer(imageSibling, sourceMap));
    inc(bySiblingImageSourceType, sourceTypeForOffer(imageSibling, sourceMap));

    const example = summarizeExample({
      canonical,
      sibling: imageSibling,
      dedupeKey,
      sourceMap,
    });

    if (examples.length < 30) examples.push(example);

    for (const query of queries) {
      if (sorted.some((offer) => offerMatchesQuery(offer, query))) {
        byQuery.set(query, (byQuery.get(query) || 0) + 1);
        if (queryExamples[query].length < 10) queryExamples[query].push(example);
      }
    }
  }

  return {
    ok: true,
    readOnly: true,
    crawlStarted: false,
    mutatedCollections: [],
    generatedAt: new Date(generatedAt).toISOString(),
    scope: {
      activeOffersRead: offers.length,
      sourceDocumentsRead: sources.length,
      queries,
      targetRetailers: TARGET_RETAILERS,
    },
    summary: {
      safeDuplicateGroups,
      canonicalWithoutImageGroups,
      potentialRepairableGroups,
      duplicateGroupCanonicalImageGapsWithoutSiblingImage,
    },
    potential: {
      byRetailer: mapRows(byRetailer),
      byCanonicalSourceKey: mapRows(byCanonicalSourceKey),
      byCanonicalSourceType: mapRows(byCanonicalSourceType),
      bySiblingImageSourceKey: mapRows(bySiblingImageSourceKey),
      bySiblingImageSourceType: mapRows(bySiblingImageSourceType),
      byQuery: [...byQuery.entries()].map(([query, count]) => ({ query, count })),
    },
    examples: {
      topRepairableCanonicalGaps: examples,
      byQuery: queryExamples,
    },
    method: {
      duplicateDefinition: 'catalogDeduper.buildDedupeKey over active offers; groups with more than one offer are treated as safe dedupe groups for this diagnostic.',
      canonicalDefinition: 'same ordering as catalogDeduper compareOffersForCanonical: active, comparisonSafe, completeness, parsingConfidence, structured fields, source channel priority, createdAt.',
      imageValidation: 'catalogDeduper.isPreservableImageUrl: non-empty http/https URL excluding obvious placeholder, spacer, transparent, blank, missing-image and no-image values.',
      mutationContract: 'read-only find/select/lean only; no crawl, no reindex, no repair, no update, no delete.',
    },
  };
}

function buildBlockedReport({ message, generatedAt = new Date() } = {}) {
  return {
    ok: false,
    partial: true,
    readOnly: true,
    crawlStarted: false,
    mutatedCollections: [],
    generatedAt: new Date(generatedAt).toISOString(),
    blocked: {
      db: true,
      dbReason: message || 'MongoDB connection unavailable.',
      unavailableMetrics: [
        'safe dedupe groups',
        'canonical/winner image gaps',
        'sibling image availability inside the same dedupe key',
        'repairable image gaps by retailer, source and query',
      ],
    },
    summary: {
      safeDuplicateGroups: null,
      canonicalWithoutImageGroups: null,
      potentialRepairableGroups: null,
      duplicateGroupCanonicalImageGapsWithoutSiblingImage: null,
    },
  };
}

function buildReportMarkdown(report = {}) {
  const lines = [
    `# Image Dedupe Repair Potential`,
    '',
    `Generated: ${report.generatedAt || ''}`,
    `Read-only: ${report.readOnly === true}`,
    `Crawl started: ${report.crawlStarted === true}`,
    `Mutated collections: ${(report.mutatedCollections || []).length}`,
    '',
  ];

  if (report.blocked?.db) {
    lines.push('## Blocked', '', report.blocked.dbReason || 'DB unavailable.', '');
    return `${lines.join('\n')}\n`;
  }

  lines.push(
    '## Summary',
    '',
    `- Active offers read: ${report.scope?.activeOffersRead ?? 0}`,
    `- Safe duplicate groups: ${report.summary?.safeDuplicateGroups ?? 0}`,
    `- Canonical image gaps in duplicate groups: ${report.summary?.canonicalWithoutImageGroups ?? 0}`,
    `- Potentially repairable image gaps: ${report.summary?.potentialRepairableGroups ?? 0}`,
    `- Canonical image gaps without sibling image: ${report.summary?.duplicateGroupCanonicalImageGapsWithoutSiblingImage ?? 0}`,
    '',
    '## Potential By Retailer',
    '',
    '| retailer | count |',
    '| --- | ---: |',
  );

  for (const row of report.potential?.byRetailer || []) {
    lines.push(`| ${row.key} | ${row.count} |`);
  }

  lines.push('', '## Potential By Query', '', '| query | count |', '| --- | ---: |');
  for (const row of report.potential?.byQuery || []) {
    lines.push(`| ${row.query} | ${row.count} |`);
  }

  lines.push('', '## Top Examples', '');
  for (const example of report.examples?.topRepairableCanonicalGaps || []) {
    lines.push(`- ${example.retailerKey}: ${example.title} (${example.canonicalOfferId}) <- ${example.siblingSourceType} ${example.siblingImageUrlShort}`);
  }

  return `${lines.join('\n')}\n`;
}

async function writeImageDedupeRepairPotentialReports(report, { outputDir = path.resolve(process.cwd(), 'tmp') } = {}) {
  await fs.mkdir(outputDir, { recursive: true });

  const summaryPath = path.join(outputDir, 'image-dedupe-repair-potential-summary.json');
  const examplesPath = path.join(outputDir, 'image-dedupe-repair-potential-examples.json');
  const markdownPath = path.join(outputDir, 'image-dedupe-repair-potential-report.md');

  await fs.writeFile(summaryPath, `${JSON.stringify({
    ok: report.ok,
    partial: report.partial,
    readOnly: report.readOnly,
    crawlStarted: report.crawlStarted,
    mutatedCollections: report.mutatedCollections,
    generatedAt: report.generatedAt,
    blocked: report.blocked,
    scope: report.scope,
    summary: report.summary,
    potential: report.potential,
    method: report.method,
  }, null, 2)}\n`);
  await fs.writeFile(examplesPath, `${JSON.stringify(report.examples || {}, null, 2)}\n`);
  await fs.writeFile(markdownPath, buildReportMarkdown(report));

  return { summaryPath, examplesPath, markdownPath };
}

module.exports = {
  TARGET_RETAILERS,
  buildBlockedReport,
  buildImageDedupeRepairPotentialDiagnostic,
  buildReportMarkdown,
  compareOffersForCanonical,
  imageDomainOrShortUrl,
  normalizedRetailerKey,
  sourceKeyForOffer,
  writeImageDedupeRepairPotentialReports,
};
