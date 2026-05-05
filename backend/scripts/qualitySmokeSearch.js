const mongoose = require('mongoose');

process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';

const { connectToDatabase } = require('../src/config/mongodb');
const {
  buildOfferRanking,
  normalizeSearchText,
} = require('../src/services/offers/offerRankingService');

const DEFAULT_TOP_N = 10;
const SEARCH_TERMS = [
  'milch',
  'butter',
  'kaffee',
  'bier',
  'waschmittel',
  'schokolade',
  'kaese',
  'joghurt',
  'huhn',
  'reis',
];

function term(...values) {
  return values.map((value) => normalizeSearchText(value)).filter(Boolean);
}

const PROFILES = {
  huhn: {
    positiveTerms: term('huhn', 'hendl', 'huehnchen', 'huhnchen', 'huehner', 'huhner', 'gefluegel', 'geflugel', 'poularde', 'chicken'),
    positiveContextTerms: term('fleisch', 'wurst und fisch', 'gefluegel'),
    negativeTerms: term('tierfutter', 'katzenfutter', 'hundefutter', 'nassfutter', 'trockenfutter', 'katze', 'katzen', 'hund', 'hunde', 'whiskas', 'sheba', 'felix', 'gourmet'),
  },
  milch: {
    positiveTerms: term('trinkmilch', 'frischmilch', 'haltbarmilch', 'vollmilch', 'heumilch', 'biomilch', 'milch 1 l', 'milch 1l', 'laktosefreie milch'),
    positiveContextTerms: term('milchprodukte', 'molkerei'),
    negativeTerms: term('seife', 'fluessigseife', 'flussigseife', 'duschgel', 'dusche', 'shampoo', 'kaese', 'kase', 'butter', 'schokolade', 'schoko', 'milchkaffee', 'eiskaffee', 'kaffeegetraenk', 'caffe latte', 'camembert', 'emmentaler', 'edamer', 'gouda', 'pudding', 'torte', 'keks', 'kekse', 'riegel', 'pralinen'),
    allowWarnOnLowPositive: true,
  },
  joghurt: {
    positiveTerms: term('joghurt', 'jogurt', 'yoghurt', 'naturjoghurt', 'fruchtjoghurt', 'skyr', 'joghurtdrink', 'joghurt drink'),
    positiveContextTerms: term('milchprodukte', 'molkerei'),
    softNegativeTerms: term('dessert', 'torte', 'riegel', 'schnitte', 'kuchen', 'margarine', 'rama'),
  },
  kaese: {
    positiveTerms: term('kaese', 'kase', 'gouda', 'emmentaler', 'bergkaese', 'bergkase', 'mozzarella', 'feta', 'camembert', 'parmesan', 'edamer', 'ricotta', 'frischkaese', 'frischkase'),
    positiveContextTerms: term('kaese', 'kase', 'milchprodukte', 'molkerei'),
    softNegativeTerms: term('mit kaese', 'mit kase', 'pizza', 'pljeskavica', 'cabanossi', 'wurst', 'fleisch', 'fertiggericht'),
  },
  kaffee: {
    positiveTerms: term('kaffee', 'bohnen', 'bohne', 'gemahlen', 'kapseln', 'kapsel', 'pads', 'espresso', 'caffe crema', 'cafe crema', 'nespresso'),
    positiveContextTerms: term('kaffee und tee', 'kaffee', 'tee'),
    negativeTerms: term('zierpflanze', 'duftgeranie', 'pflanze'),
    softNegativeTerms: term('eiskaffee', 'kaffeegetraenk', 'kaffee getraenk', 'caffe latte', 'drink', 'dessert', 'riegel', 'schokolade'),
  },
  waschmittel: {
    positiveTerms: term('waschmittel', 'waschpulver', 'waschgel', 'waschmittel fluessig', 'waschmittel flussig', 'caps', 'pods', 'discs', 'vollwaschmittel', 'colorwaschmittel', 'color waschmittel', 'pulver'),
    positiveContextTerms: term('waschmittel', 'waesche', 'wasche'),
    softNegativeTerms: term('spuelmittel', 'spulmittel', 'geschirr', 'kosmetik', 'shampoo', 'allzweck', 'wc', 'tuecher', 'tucher', 'schmutzradierer', 'desinfektion'),
  },
  bier: {
    positiveTerms: term('bier', 'maerzen', 'marzen', 'pils', 'radler', 'lager', 'weizenbier', 'weissbier', 'alkoholfrei'),
    positiveContextTerms: term('bier', 'getraenke', 'getranke'),
    softNegativeTerms: term('bierwurst', 'bierschinken'),
  },
  reis: {
    positiveTerms: term('reis', 'basmati', 'jasmin', 'langkorn', 'expressreis', 'risotto', 'milchreis', 'reisgericht'),
    positiveContextTerms: term('reis', 'pasta', 'grundnahrungsmittel'),
    softNegativeTerms: term('reisdrink', 'milchersatz', 'drink'),
  },
  butter: {
    positiveTerms: term('butter', 'teebutter', 'streichfett', 'butterschmalz', 'margarine'),
    positiveContextTerms: term('butter', 'margarine', 'milchprodukte', 'molkerei'),
    softNegativeTerms: term('butterkeks', 'butterkekse', 'keks', 'kekse', 'cookie', 'cookies', 'riegel', 'suesswaren', 'susswaren', 'buttercroissant', 'gebaeck', 'geback', 'kosmetik', 'lippenbalsam', 'peanut', 'protein', 'cups'),
  },
  schokolade: {
    positiveTerms: term('schokolade', 'schoko', 'tafelschokolade', 'pralinen', 'praline', 'riegel', 'milka', 'lindt', 'merci', 'zartbitter', 'vollmilchschokolade'),
    positiveContextTerms: term('suesswaren', 'susswaren', 'knabbereien', 'schokolade'),
    softNegativeTerms: term('dessert', 'pudding', 'torte', 'kuchen', 'creme'),
  },
};

function parseArgs(argv) {
  const options = {
    top: DEFAULT_TOP_N,
    json: false,
  };

  for (const arg of argv) {
    if (arg === '--json') {
      options.json = true;
      continue;
    }

    if (arg.startsWith('--top=')) {
      const value = Number(arg.slice('--top='.length));

      if (Number.isInteger(value) && value >= 5 && value <= 50) {
        options.top = value;
      }
    }
  }

  return options;
}

function includesTerm(normalizedValue, normalizedTerm) {
  return ` ${normalizedValue} `.includes(` ${normalizedTerm} `);
}

function matchingTerms(normalizedValue, terms = []) {
  return terms.filter((item) => includesTerm(normalizedValue, item));
}

function offerSearchText(offer) {
  return normalizeSearchText([
    offer.title,
    offer.titleNormalized,
    offer.brand,
    offer.categoryPrimary,
    offer.categorySecondary,
    offer.subcategoryKey,
    offer.comparisonGroup,
    offer.searchText,
  ].filter(Boolean).join(' '));
}

function classifyOffer(offer, profile) {
  const text = offerSearchText(offer);
  const positives = matchingTerms(text, profile.positiveTerms);
  const contextPositives = matchingTerms(text, profile.positiveContextTerms);
  const negatives = matchingTerms(text, profile.negativeTerms);
  const softNegatives = matchingTerms(text, profile.softNegativeTerms);
  const isPositive = positives.length > 0 || contextPositives.length > 0;
  const isHardNegative = negatives.length > 0;
  const isSoftNegative = softNegatives.length > 0 && !isHardNegative;

  return {
    isPositive,
    isHardNegative,
    isSoftNegative,
    positives,
    contextPositives,
    negatives,
    softNegatives,
  };
}

function summarizeOffer(offer, classification, index) {
  const retailer = offer.retailerName || offer.sourceRetailerName || offer.retailerKey || 'unknown';
  const markers = [];

  if (classification.isHardNegative) {
    markers.push(`NEG: ${classification.negatives.join(', ')}`);
  } else if (classification.isSoftNegative) {
    markers.push(`SOFT: ${classification.softNegatives.join(', ')}`);
  }

  if (classification.isPositive) {
    markers.push(`POS: ${classification.positives.concat(classification.contextPositives).join(', ')}`);
  }

  return {
    rank: index + 1,
    title: offer.title || '',
    retailer,
    category: [offer.categoryPrimary, offer.categorySecondary].filter(Boolean).join(' > '),
    markers,
  };
}

function evaluateTerm(query, offers) {
  const profile = PROFILES[query];
  const inspected = offers.map((offer, index) => {
    const classification = classifyOffer(offer, profile);

    return {
      offer,
      classification,
      summary: summarizeOffer(offer, classification, index),
    };
  });
  const topFive = inspected.slice(0, 5);
  const hardNegativeCount = inspected.filter((item) => item.classification.isHardNegative).length;
  const topFiveHardNegativeCount = topFive.filter((item) => item.classification.isHardNegative).length;
  const softNegativeCount = inspected.filter((item) => item.classification.isSoftNegative).length;
  const positiveCount = inspected.filter((item) => item.classification.isPositive).length;
  const reasons = [];
  let status = 'PASS';

  if (offers.length === 0) {
    return {
      query,
      status: 'WARN',
      reasons: ['No ranked offers returned by the current ranking logic.'],
      offers: [],
      counts: { inspected: 0, positive: 0, softNegative: 0, hardNegative: 0 },
    };
  }

  if (topFive[0]?.classification.isHardNegative && !topFive[0]?.classification.isPositive) {
    status = 'FAIL';
    reasons.push('Top result is a clear negative match.');
  }

  if (topFiveHardNegativeCount >= 2 || hardNegativeCount >= Math.ceil(inspected.length / 3)) {
    status = 'FAIL';
    reasons.push('Clear negative matches dominate too much of the inspected top results.');
  }

  if (status !== 'FAIL' && positiveCount === 0) {
    status = 'WARN';
    reasons.push('No clearly positive product signal found in the inspected top results.');
  }

  if (status !== 'FAIL' && positiveCount < Math.min(3, Math.ceil(inspected.length / 3))) {
    status = 'WARN';
    reasons.push('Only few clearly positive product signals found; current data coverage may be weak.');
  }

  if (status !== 'FAIL' && softNegativeCount > positiveCount && !profile.allowWarnOnLowPositive) {
    status = 'WARN';
    reasons.push('Soft negative side matches are more common than clear positive matches.');
  }

  return {
    query,
    status,
    reasons,
    offers: inspected.map((item) => item.summary),
    counts: {
      inspected: inspected.length,
      positive: positiveCount,
      softNegative: softNegativeCount,
      hardNegative: hardNegativeCount,
    },
  };
}

function printTextReport(results, options) {
  console.log(`Search Quality Smoke (${new Date().toISOString()})`);
  console.log(`Top-N: ${options.top}`);

  for (const result of results) {
    console.log('');
    console.log(`[${result.status}] ${result.query}`);
    console.log(`Counts: positive=${result.counts.positive}, softNegative=${result.counts.softNegative}, hardNegative=${result.counts.hardNegative}, inspected=${result.counts.inspected}`);

    for (const reason of result.reasons) {
      console.log(`Reason: ${reason}`);
    }

    for (const offer of result.offers) {
      const markerText = offer.markers.length > 0 ? ` (${offer.markers.join(' | ')})` : '';
      const categoryText = offer.category ? ` - ${offer.category}` : '';

      console.log(`${String(offer.rank).padStart(2, ' ')}. ${offer.title} [${offer.retailer}]${categoryText}${markerText}`);
    }
  }

  const summary = results.reduce((acc, result) => {
    acc[result.status] += 1;
    return acc;
  }, { PASS: 0, WARN: 0, FAIL: 0 });

  console.log('');
  console.log(`Summary: PASS=${summary.PASS}, WARN=${summary.WARN}, FAIL=${summary.FAIL}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  await connectToDatabase();

  const results = [];

  for (const query of SEARCH_TERMS) {
    const ranking = await buildOfferRanking({
      query,
      unit: 'all',
      limit: options.top,
    });

    results.push(evaluateTerm(query, ranking.rankedOffers || []));
  }

  if (options.json) {
    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      top: options.top,
      results,
      summary: results.reduce((acc, result) => {
        acc[result.status] += 1;
        return acc;
      }, { PASS: 0, WARN: 0, FAIL: 0 }),
    }, null, 2));
  } else {
    printTextReport(results, options);
  }

  if (results.some((result) => result.status === 'FAIL')) {
    process.exitCode = 1;
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
