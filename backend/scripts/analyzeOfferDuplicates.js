const mongoose = require('mongoose');

process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';

const { connectToDatabase } = require('../src/config/mongodb');
const Offer = require('../src/models/Offer');
const { normalizeTitleForMatch } = require('../src/services/crawl/sourceEvidence');

const DEFAULT_LIMIT = 5000;
const DEFAULT_EXAMPLES = 8;

const STOP_WORDS = new Set([
  'ab',
  'aktion',
  'angebot',
  'artikel',
  'bei',
  'bio',
  'der',
  'die',
  'das',
  'den',
  'dem',
  'des',
  'ein',
  'eine',
  'einer',
  'fur',
  'fuer',
  'gratis',
  'kg',
  'l',
  'liter',
  'mit',
  'nur',
  'oder',
  'packung',
  'pro',
  'statt',
  'stueck',
  'stk',
  'und',
  'von',
  'zum',
]);

function parseArgs(argv) {
  const options = {
    limit: DEFAULT_LIMIT,
    examples: DEFAULT_EXAMPLES,
    json: false,
  };

  for (const arg of argv) {
    if (arg === '--json') {
      options.json = true;
      continue;
    }

    if (arg.startsWith('--limit=')) {
      const value = Number(arg.slice('--limit='.length));

      if (Number.isInteger(value) && value >= 100 && value <= 50000) {
        options.limit = value;
      }
    }

    if (arg.startsWith('--examples=')) {
      const value = Number(arg.slice('--examples='.length));

      if (Number.isInteger(value) && value >= 1 && value <= 50) {
        options.examples = value;
      }
    }
  }

  return options;
}

function dateKey(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function numberKey(value, digits = 3) {
  const number = Number(value);

  return Number.isFinite(number) ? number.toFixed(digits) : '';
}

function normalizeKey(value) {
  return normalizeTitleForMatch(value).replace(/\s+/g, '-');
}

function normalizedTitle(offer) {
  return normalizeTitleForMatch(offer.titleNormalized || offer.title || '');
}

function titleTokens(offer) {
  return normalizedTitle(offer)
    .split(/\s+/)
    .filter((token) => token.length >= 3)
    .filter((token) => !STOP_WORDS.has(token))
    .filter((token) => !/^\d+$/.test(token));
}

function tokenSet(offer) {
  return new Set(titleTokens(offer));
}

function jaccard(leftSet, rightSet) {
  if (leftSet.size === 0 && rightSet.size === 0) {
    return 1;
  }

  const intersection = [...leftSet].filter((token) => rightSet.has(token)).length;
  const union = new Set([...leftSet, ...rightSet]).size;

  return union > 0 ? intersection / union : 0;
}

function retailerScopeKey(offer) {
  const formats = [
    ...(offer.appliesToRetailerFormats || []),
    ...(offer.retailerFormats || []),
    offer.sourceRetailerFormat,
  ].filter(Boolean).map(normalizeKey).sort();

  return [
    normalizeKey(offer.retailerKey || offer.retailerName || ''),
    [...new Set(formats)].join(','),
  ].join('::');
}

function primaryProductIdentityKey(offer) {
  if (offer.comparisonSignature) {
    return normalizeKey(offer.comparisonSignature);
  }

  return normalizedTitle(offer);
}

function fallbackProductIdentityKey(offer) {
  return normalizedTitle(offer);
}

function quantityKey(offer) {
  return [
    numberKey(offer.packCount, 0),
    numberKey(offer.unitValue, 3),
    normalizeKey(offer.unitType || ''),
    numberKey(offer.totalComparableAmount, 3),
    normalizeKey(offer.comparableUnit || offer.normalizedUnitPrice?.unit || ''),
    normalizeKey(offer.packageType || ''),
    normalizeKey(offer.quantityText || ''),
  ].join('|');
}

function priceKey(offer) {
  return [
    numberKey(offer.priceCurrent?.amount, 2),
    normalizeKey(offer.priceCurrent?.currency || 'EUR'),
    numberKey(offer.normalizedUnitPrice?.amount, 4),
    normalizeKey(offer.normalizedUnitPrice?.unit || ''),
  ].join('|');
}

function conditionKey(offer) {
  return [
    normalizeKey(offer.effectiveDiscountType || offer.benefitType || ''),
    offer.customerProgramRequired ? 'program' : 'public',
    offer.hasConditions ? 'conditions' : 'no-conditions',
    offer.isMultiBuy ? 'multi-buy' : 'single',
    numberKey(offer.minimumPurchaseQty, 0),
    normalizeKey(offer.conditionsText || ''),
  ].join('|');
}

function validityKey(offer) {
  return [dateKey(offer.validFrom), dateKey(offer.validTo)].join('|');
}

function strongIdentityKey(offer, productKey) {
  return [
    retailerScopeKey(offer),
    productKey,
    quantityKey(offer),
    priceKey(offer),
    conditionKey(offer),
    validityKey(offer),
  ].join('::');
}

function looseBucketsForOffer(offer) {
  const tokens = titleTokens(offer).slice(0, 4);
  const category = normalizeKey(
    offer.comparisonCategoryKey
    || offer.subcategoryKey
    || offer.categoryKey
    || offer.categorySecondary
    || offer.categoryPrimary
    || ''
  );
  const group = normalizeKey(offer.comparisonGroup || '');
  const brand = normalizeKey(offer.brand || '');
  const bases = [group, brand, ...tokens].filter(Boolean).slice(0, 4);

  return [...new Set(bases.map((base) => [retailerScopeKey(offer), category, base].join('::')))];
}

function buildProtectedDifferenceReasons(offers) {
  const checks = [
    ['retailer', (offer) => retailerScopeKey(offer)],
    ['packungs-/vergleichsmenge', quantityKey],
    ['preis', priceKey],
    ['rabatt-/mindestmengenlogik', conditionKey],
    ['kundenkarten-/app-bedingung', (offer) => offer.customerProgramRequired ? 'program' : 'public'],
    ['gueltigkeitszeitraum', validityKey],
    ['quelle', (offer) => [
      String(offer.sourceId || ''),
      normalizeKey(offer.sourceType || ''),
      normalizeKey(offer.sourceUrl || ''),
    ].join('|')],
  ];

  return checks
    .filter(([, getValue]) => new Set(offers.map(getValue)).size > 1)
    .map(([label]) => label);
}

function summarizeOffer(offer) {
  return {
    id: String(offer._id),
    retailer: offer.retailerName || offer.retailerKey || '',
    title: offer.title || '',
    price: offer.priceCurrent?.amount ?? null,
    unitPrice: offer.normalizedUnitPrice?.amount ?? null,
    unit: offer.normalizedUnitPrice?.unit || offer.comparableUnit || '',
    quantity: offer.quantityText || '',
    discount: offer.effectiveDiscountType || offer.benefitType || '',
    minQty: offer.minimumPurchaseQty ?? null,
    customerProgramRequired: Boolean(offer.customerProgramRequired),
    validFrom: dateKey(offer.validFrom),
    validTo: dateKey(offer.validTo),
    sourceType: offer.sourceType || '',
    sourceUrl: offer.sourceUrl || '',
  };
}

function summarizeGroup({ offers, classification, reason, similarity = 1 }) {
  const protectedDifferences = buildProtectedDifferenceReasons(offers);

  return {
    classification,
    reason,
    similarity: Number(similarity.toFixed(3)),
    count: offers.length,
    protectedDifferences,
    suggestedConservativeAction: classification === 'starke Dublette'
      ? 'Spaeter nur zusammenfuehren, wenn Schutzfelder weiterhin identisch bleiben.'
      : 'Manuell pruefen; Unterschiede nicht automatisch zusammenfuehren.',
    offers: offers.map(summarizeOffer),
  };
}

function groupByStrongIdentity(offers) {
  const groups = new Map();

  for (const offer of offers) {
    const keys = [
      primaryProductIdentityKey(offer),
      fallbackProductIdentityKey(offer),
    ].filter(Boolean).map((productKey) => strongIdentityKey(offer, productKey));

    for (const key of new Set(keys)) {
      if (!groups.has(key)) {
        groups.set(key, []);
      }

      groups.get(key).push(offer);
    }
  }

  const seenGroupIds = new Set();

  return [...groups.values()]
    .filter((group) => group.length > 1)
    .filter((group) => {
      const groupIds = group.map((offer) => String(offer._id)).sort().join('::');

      if (seenGroupIds.has(groupIds)) {
        return false;
      }

      seenGroupIds.add(groupIds);
      return true;
    });
}

function buildSimilarGroups(offers, strongOfferIds) {
  const buckets = new Map();

  for (const offer of offers) {
    for (const key of looseBucketsForOffer(offer)) {
      if (!buckets.has(key)) {
        buckets.set(key, []);
      }

      buckets.get(key).push(offer);
    }
  }

  const seenPairs = new Set();
  const groups = [];

  for (const bucketOffers of buckets.values()) {
    if (bucketOffers.length < 2 || bucketOffers.length > 80) {
      continue;
    }

    for (let leftIndex = 0; leftIndex < bucketOffers.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < bucketOffers.length; rightIndex += 1) {
        const left = bucketOffers[leftIndex];
        const right = bucketOffers[rightIndex];

        if (String(left._id) === String(right._id)) {
          continue;
        }

        const pairKey = [String(left._id), String(right._id)].sort().join('::');

        if (seenPairs.has(pairKey)) {
          continue;
        }

        seenPairs.add(pairKey);

        if (retailerScopeKey(left) !== retailerScopeKey(right)) {
          continue;
        }

        const similarity = jaccard(tokenSet(left), tokenSet(right));
        const sameProductSignal = primaryProductIdentityKey(left) && primaryProductIdentityKey(left) === primaryProductIdentityKey(right);
        const samePrice = priceKey(left) === priceKey(right);
        const sameCategory = normalizeKey(left.categoryKey || '') === normalizeKey(right.categoryKey || '');

        if (similarity < 0.72 && !sameProductSignal) {
          continue;
        }

        if (!samePrice && similarity < 0.86) {
          continue;
        }

        const protectedDifferences = buildProtectedDifferenceReasons([left, right]);

        if (protectedDifferences.length === 0 && strongOfferIds.has(String(left._id)) && strongOfferIds.has(String(right._id))) {
          continue;
        }

        if (!sameCategory && !sameProductSignal) {
          continue;
        }

        groups.push(summarizeGroup({
          offers: [left, right],
          classification: 'nur aehnlich / pruefen',
          reason: protectedDifferences.length > 0
            ? `Hohe Text-/Produktsignal-Aehnlichkeit, aber Schutzfelder unterscheiden sich: ${protectedDifferences.join(', ')}.`
            : 'Hohe Text-/Produktsignal-Aehnlichkeit ohne identischen starken Schluessel.',
          similarity,
        }));
      }
    }
  }

  return groups
    .sort((left, right) => right.similarity - left.similarity || right.count - left.count);
}

async function loadRelevantOffers(limit) {
  const now = new Date();

  return Offer.find({
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
  })
    .sort({ retailerKey: 1, categoryKey: 1, title: 1, validTo: 1 })
    .limit(limit)
    .select([
      '_id',
      'retailerKey',
      'retailerName',
      'sourceRetailerFormat',
      'retailerFormats',
      'appliesToRetailerFormats',
      'sourceId',
      'title',
      'titleNormalized',
      'brand',
      'categoryPrimary',
      'categorySecondary',
      'categoryKey',
      'subcategoryKey',
      'comparisonSignature',
      'comparisonGroup',
      'comparisonCategoryKey',
      'priceCurrent',
      'normalizedUnitPrice',
      'quantityText',
      'packCount',
      'unitValue',
      'unitType',
      'totalComparableAmount',
      'comparableUnit',
      'packageType',
      'benefitType',
      'effectiveDiscountType',
      'conditionsText',
      'customerProgramRequired',
      'hasConditions',
      'isMultiBuy',
      'minimumPurchaseQty',
      'validFrom',
      'validTo',
      'status',
      'isActiveNow',
      'isActiveToday',
      'sourceType',
      'sourceUrl',
      'sourceUrls',
      'dedupeKey',
      'quality',
    ].join(' '))
    .lean();
}

function buildReport(offers, options) {
  const strongGroups = groupByStrongIdentity(offers)
    .map((group) => summarizeGroup({
      offers: group,
      classification: 'starke Dublette',
      reason: 'Gleicher Haendler/Format-Scope, Produkt-/Mengen-/Preis-/Bedingungs-/Gueltigkeits-Schluessel.',
    }))
    .sort((left, right) => right.count - left.count);
  const strongOfferIds = new Set(strongGroups.flatMap((group) => group.offers.map((offer) => offer.id)));
  const similarGroups = buildSimilarGroups(offers, strongOfferIds);
  const strongDuplicateOfferCount = strongGroups.reduce((sum, group) => sum + group.count - 1, 0);

  return {
    generatedAt: new Date().toISOString(),
    mode: 'read-only',
    inspectedOfferCount: offers.length,
    options,
    summary: {
      strongDuplicateGroups: strongGroups.length,
      strongDuplicateExtraOffers: strongDuplicateOfferCount,
      similarReviewGroups: similarGroups.length,
      conservativeNextRuleCandidate: 'Automatisches Zusammenfuehren nur fuer starke Dubletten mit identischem Haendler/Format, Menge, Preis, Rabattlogik, Kundenprogramm und Gueltigkeit; Quellen immer als Evidenz erhalten und bei abweichenden Quellen vor produktiver Dedupe pruefen.',
    },
    strongDuplicates: strongGroups.slice(0, options.examples),
    similarReview: similarGroups.slice(0, options.examples),
  };
}

function printTextReport(report) {
  console.log(`Offer Duplicate Analysis (${report.generatedAt})`);
  console.log('Mode: read-only');
  console.log(`Inspected active/currently relevant offers: ${report.inspectedOfferCount}`);
  console.log('');
  console.log(`Summary: strongGroups=${report.summary.strongDuplicateGroups}, strongExtraOffers=${report.summary.strongDuplicateExtraOffers}, similarReviewGroups=${report.summary.similarReviewGroups}`);
  console.log(`Rule candidate: ${report.summary.conservativeNextRuleCandidate}`);

  for (const section of [
    ['Strong duplicate suspicion', report.strongDuplicates],
    ['Similar / review only', report.similarReview],
  ]) {
    const [title, groups] = section;

    console.log('');
    console.log(title);

    if (groups.length === 0) {
      console.log('  No groups found.');
      continue;
    }

    groups.forEach((group, index) => {
      const differences = group.protectedDifferences.length > 0
        ? ` protectedDifferences=${group.protectedDifferences.join(', ')}`
        : '';

      console.log(`  ${index + 1}. ${group.classification} count=${group.count} similarity=${group.similarity}${differences}`);
      console.log(`     ${group.reason}`);

      group.offers.forEach((offer) => {
        const price = offer.price === null ? 'price=?' : `price=${offer.price}`;
        const validity = [offer.validFrom, offer.validTo].filter(Boolean).join('..') || 'validity=?';
        const program = offer.customerProgramRequired ? 'program' : 'public';

        console.log(`     - ${offer.title} [${offer.retailer}] id=${offer.id} ${price} qty="${offer.quantity}" ${program} ${validity} source=${offer.sourceType || '?'}`);
      });
    });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  await connectToDatabase();

  const offers = await loadRelevantOffers(options.limit);
  const report = buildReport(offers, options);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printTextReport(report);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
