const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');

process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';

const env = require('../src/config/env');
const { connectToDatabase } = require('../src/config/mongodb');
const Offer = require('../src/models/Offer');
const { determineCategoryDecision } = require('../src/services/crawl/categoryClassifier');
const { normalizeTitleForMatch, sanitizeWhitespace } = require('../src/services/crawl/sourceEvidence');
const {
  buildProjectedCategoryDecision,
  extractSourceCategory,
  hoferSourceBucket,
  isGenericOrWeakCategory,
} = require('../src/services/diagnostics/marketCoverageDiagnostic');
const { buildOfferRanking, clearRankingResponseCache } = require('../src/services/offers/offerRankingService');

const DEVELOPMENT_DB_NAME = 'einfachsparen_dev';
const DEFAULT_PROFILE = 'default';
const HOFER_CATEGORY_PROFILE = 'hofer-category';
const DEFAULT_LIMIT = 50;
const HOFER_PROFILE_LIMIT = 1000;
const DEFAULT_MAX_UPDATES = 20;
const SNAPSHOT_DIR = 'tmp';
const RANKING_QUERIES = [
  'schartner',
  'gasteiner',
  'spumante',
  'barilla',
  'fischstäbchen',
  'butter',
  'huhn',
  'reis',
];

const ALLOWLIST_RULES = [
  { key: 'schartner-bombe', pattern: /Schartner Bombe/i, allowedTargets: [['Getraenke', 'Softdrinks & Energy']] },
  { key: 'gasteiner-infinity-water', pattern: /Gasteiner Infinity Water/i, allowedTargets: [['Getraenke', 'Wasser']] },
  { key: 'la-gioiosa-spumante', pattern: /La Gioiosa Spumante/i, allowedTargets: [['Getraenke', 'Wein & Sekt']] },
  { key: 'barilla-teigwaren', pattern: /Barilla.*Teigwaren/i, allowedTargets: [['Lebensmittel', 'Pasta, Reis & Konserven']] },
  {
    key: 'fisch-ofenback',
    pattern: /Fischstäbchen|Fischstaebchen|Ofenbackfisch|Filegro|Polar-Dorsch|Polar Dorsch/i,
    allowedTargets: [
      ['Lebensmittel', 'Fleisch, Wurst & Fisch'],
      ['Lebensmittel', 'Tiefkuehl- & Fertigprodukte'],
    ],
  },
  {
    key: 'iglo-gemuese',
    pattern: /Röstgemüse|Roestgemuese|Buttergemüse|Buttergemuese|Gemüse-Reindl|Gemuese-Reindl|Gemüse a la Creme|Gemuese a la Creme/i,
    allowedTargets: [
      ['Lebensmittel', 'Tiefkuehl- & Fertigprodukte'],
      ['Lebensmittel', 'Obst & Gemuese'],
    ],
  },
  { key: 'hendl-gefluegel', pattern: /Hendl|Geflügel|Gefluegel/i, allowedTargets: [['Lebensmittel', 'Fleisch, Wurst & Fisch']] },
  { key: 'passata-di-pomodoro', pattern: /Passata di Pomodoro/i, allowedTargets: [['Lebensmittel', 'Pasta, Reis & Konserven']] },
];

const HOFER_ALLOWED_TARGETS = [
  ['Getraenke', 'Softdrinks & Energy'],
  ['Haushalt', 'Waschmittel & Reiniger'],
  ['Haushalt', 'Lufterfrischer & Raumduft'],
  ['Drogerie / Hygiene', 'Haarpflege'],
  ['Drogerie / Hygiene', 'Koerperpflege'],
  ['Drogerie / Hygiene', 'Mund- & Zahnpflege'],
  ['Drogerie / Hygiene', 'Rasur'],
  ['Drogerie / Hygiene', 'Kosmetik & Make-up'],
  ['Drogerie / Hygiene', 'Damenhygiene'],
  ['Drogerie / Hygiene', 'Babyhygiene'],
  ['Drogerie / Hygiene', 'Gesundheit & Nahrungsergaenzung'],
  ['Baby / Kinder', 'Babybedarf'],
  ['Baby / Kinder', 'Kinderpflege'],
  ['Tierbedarf', 'Hundefutter'],
  ['Tierbedarf', 'Katzenfutter'],
  ['Tierbedarf', 'Katzenstreu & Pflege'],
  ['Tierbedarf', 'Tierzubehoer'],
  ['Lebensmittel', 'Suesswaren & Knabbereien'],
  ['Lebensmittel', 'Pasta, Reis & Konserven'],
  ['Lebensmittel', 'Fleisch, Wurst & Fisch'],
  ['Lebensmittel', 'Tiefkuehl- & Fertigprodukte'],
  ['Garten / Pflanzen', 'Pflanzen & Blumen'],
  ['Garten / Pflanzen', 'Erde & Duenger'],
  ['Garten / Pflanzen', 'Gartenzubehoer'],
  ['Technik / Elektronik', 'Werkzeug & Akkus'],
  ['Technik / Elektronik', 'Kuechengeraete'],
  ['Freizeit / Sonstiges', 'Sport & Camping'],
];

const HOFER_PRODUCT_SIGNAL_PATTERNS = [
  /\b(powerade|isostar|cola|kola|limonade|limo|softdrink|energy|energydrink|eistee|isodrink|drink)\b/i,
  /\b(tandil|alio)\b.*\b(waschmittel|reiniger|putzmittel|spuelmittel|spulmittel|geschirrspuel|geschirrspul|tabs|waschcaps|entkalker)\b/i,
  /\b(waschmittel|reiniger|putzmittel|spuelmittel|spulmittel|geschirrspuel|geschirrspul|tabs|waschcaps|entkalker)\b.*\b(tandil|alio)\b/i,
  /\b(ombia)\b.*\b(shampoo|duschgel|dusch|creme|lotion|deo|deodorant|seife|haarkur|spuelung|spulung)\b/i,
  /\b(shampoo|duschgel|dusch|creme|lotion|deo|deodorant|seife|haarkur|spuelung|spulung)\b.*\b(ombia)\b/i,
  /\b(mamia)\b.*\b(windel|windeln|feuchttuecher|feuchttucher|babynahrung|babycreme|babyshampoo)\b/i,
  /\b(windel|windeln|feuchttuecher|feuchttucher|babynahrung|babycreme|babyshampoo)\b.*\b(mamia)\b/i,
  /\b(romeo)\b.*\b(hundefutter|hundesnack|katzenfutter|katzensnack|hund|katze)\b/i,
  /\b(hundefutter|hundesnack|katzenfutter|katzensnack|hund|katze)\b.*\b(romeo)\b/i,
  /\b(choceur)\b.*\b(schokolade|praline|pralinen|nougat|riegel)\b/i,
  /\b(schokolade|praline|pralinen|nougat|riegel)\b.*\b(choceur)\b/i,
  /\b(cucina nobile)\b.*\b(pasta|pesto|passata|polpa|sugo|nudel|nudeln|spaghetti|penne|fusilli)\b/i,
  /\b(pasta|pesto|passata|polpa|sugo|nudel|nudeln|spaghetti|penne|fusilli)\b.*\b(cucina nobile)\b/i,
  /\b(bbq)\b.*\b(hendl|huhn|grillfleisch|faschiert|fleisch|schwein|rind)\b/i,
  /\b(hendl|huhn|grillfleisch|faschiert|fleisch|schwein|rind)\b.*\b(bbq)\b/i,
  /\b(grandessa)\b.*\b(eis|eiscreme)\b/i,
  /\b(eis|eiscreme)\b.*\b(grandessa)\b/i,
  /\b(e-bike|e bike|ebike|fahrrad|mountainbike|trekking e-bike|trekking e bike)\b/i,
  /\b(camping|hocker|zubehoer|zubehör|koch-set|koch-sets|schlafsack|outdoorkueche|outdoorküche|gewichtsweste|aluminiumbox|aluminiumboxen|toilette|campingkuehlbox|campingkühlbox|kuehlbox|kühlbox|pool|stahlwandpool|outdoorbox)\b/i,
  /\b(pflanze|pflanzen|blume|blumen|orchidee|rose|topfpflanze|erde|duenger|dunger|hochbeet|blumenerde|gartenschlauch|rasenmaeher|rasenmäher)\b/i,
  /\b(werkzeug|bohrer|akkuschrauber|akku schrauber|bit-set|bit set|werkzeugkoffer|schraubendreher|stichsaege|stichsäge|hochdruckreiniger|reinigungseimer)\b/i,
  /\b(dickmann|dickmanns|white mousse|schokolade|schaumkuss|schaumkuesse|schaumküsse)\b/i,
];

const HOFER_DEVICE_TOOL_PATTERNS = [
  /\b(hochdruckreiniger|reinigungseimer|werkzeug|bohrer|akkuschrauber|akku schrauber|bit-set|bit set|werkzeugkoffer|schraubendreher|stichsaege|stichsÃ¤ge)\b/i,
];

const HOFER_SAFE_DEVICE_TOOL_TARGETS = [
  ['Technik / Elektronik', 'Werkzeug & Akkus'],
  ['Technik / Elektronik', 'Kuechengeraete'],
];

const OFFER_SELECT_FIELDS = [
  '_id',
  'title',
  'titleNormalized',
  'brand',
  'description',
  'retailerKey',
  'retailerName',
  'sourceRetailerName',
  'sourceRetailerFormat',
  'sourceType',
  'categoryPrimary',
  'categorySecondary',
  'categoryKey',
  'subcategoryKey',
  'comparisonCategoryKey',
  'categoryConfidence',
  'subcategoryConfidence',
  'searchText',
  'rawFacts',
  'priceCurrent',
  'quantityText',
  'validFrom',
  'validTo',
  'sourceId',
  'sourceUrl',
  'sourceUrls',
  'evidenceUrls',
  'dedupeKey',
  'offerKey',
  'comparisonGroup',
].join(' ');

function parseArgs(argv = []) {
  const options = {
    apply: false,
    json: false,
    writeSnapshots: false,
    profile: DEFAULT_PROFILE,
    limit: DEFAULT_LIMIT,
    maxUpdates: DEFAULT_MAX_UPDATES,
  };

  for (const arg of argv) {
    if (arg === '--apply') {
      options.apply = true;
      continue;
    }

    if (arg === '--json') {
      options.json = true;
      continue;
    }

    if (arg === '--write-snapshots') {
      options.writeSnapshots = true;
      continue;
    }

    if (arg.startsWith('--profile=')) {
      const value = String(arg.slice('--profile='.length) || '').trim();
      options.profile = value || DEFAULT_PROFILE;
      if (options.profile === HOFER_CATEGORY_PROFILE && options.limit === DEFAULT_LIMIT) {
        options.limit = HOFER_PROFILE_LIMIT;
      }
      continue;
    }

    if (arg.startsWith('--limit=')) {
      const value = Number(arg.slice('--limit='.length));
      if (Number.isInteger(value) && value > 0 && value <= 500) {
        options.limit = value;
      }
      continue;
    }

    if (arg.startsWith('--max-updates=')) {
      const value = Number(arg.slice('--max-updates='.length));
      if (Number.isInteger(value) && value >= 0 && value <= 100) {
        options.maxUpdates = value;
      }
    }
  }

  return options;
}

function isHoferCategoryProfile(options = {}) {
  return options.profile === HOFER_CATEGORY_PROFILE;
}

function buildNormalizedKey(value, fallback = '') {
  return normalizeTitleForMatch(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
}

function createSearchTextFromOffer(offer = {}) {
  return normalizeTitleForMatch([
    offer.retailerName,
    offer.brand,
    offer.title,
    offer.titleNormalized,
    offer.categoryPrimary,
    offer.categorySecondary,
    offer.categoryKey,
    offer.quantityText,
    offer.conditionsText,
  ].filter(Boolean).join(' '));
}

function matchedAllowlistRules(offer = {}) {
  const title = String(offer.title || '');
  return ALLOWLIST_RULES.filter((rule) => rule.pattern.test(title)).map((rule) => rule.key);
}

function matchedAllowlistRuleObjects(offer = {}) {
  const title = String(offer.title || '');
  return ALLOWLIST_RULES.filter((rule) => rule.pattern.test(title));
}

function isAllowedProjectedTarget(rules = [], decision = {}) {
  return rules.some((rule) =>
    (rule.allowedTargets || []).some(([primary, secondary]) =>
      decision.primaryCategory === primary && decision.secondaryCategory === secondary
    )
  );
}

function isAllowedHoferTarget(decision = {}) {
  return HOFER_ALLOWED_TARGETS.some(([primary, secondary]) =>
    decision.primaryCategory === primary && decision.secondaryCategory === secondary
  );
}

function isHoferOffer(offer = {}) {
  const retailerKey = normalizeTitleForMatch(offer.retailerKey || '');
  const sourceRetailerFormat = normalizeTitleForMatch(offer.sourceRetailerFormat || '');
  const retailerName = normalizeTitleForMatch([
    offer.retailerName,
    offer.sourceRetailerName,
  ].filter(Boolean).join(' '));

  return retailerKey === 'hofer'
    || sourceRetailerFormat === 'hofer'
    || /\bhofer\b/.test(retailerName);
}

function hasSafeHoferProductSignal(offer = {}) {
  const title = sanitizeWhitespace(offer.title || '');

  if (!title) {
    return false;
  }

  return HOFER_PRODUCT_SIGNAL_PATTERNS.some((pattern) => pattern.test(title));
}

function isHoferDeviceOrToolOffer(offer = {}) {
  const title = sanitizeWhitespace(offer.title || '');
  return HOFER_DEVICE_TOOL_PATTERNS.some((pattern) => pattern.test(title));
}

function isSafeHoferDeviceToolTarget(decision = {}) {
  return HOFER_SAFE_DEVICE_TOOL_TARGETS.some(([primary, secondary]) =>
    decision.primaryCategory === primary && decision.secondaryCategory === secondary
  );
}

function isWeakProjection(decision = {}) {
  return decision.needsReview
    || decision.primaryCategory === 'Unkategorisiert'
    || !decision.primaryCategory
    || !decision.secondaryCategory
    || decision.secondaryCategory === 'Sonstiges'
    || Number(decision.categoryConfidence || 0) < 0.55;
}

function dateIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function searchTextSummary(value = '') {
  const text = String(value || '');
  return {
    length: text.length,
    excerpt: text.slice(0, 180),
  };
}

function summarizeOffer(offer = {}) {
  return {
    _id: String(offer._id || ''),
    title: offer.title || '',
    retailerKey: offer.retailerKey || '',
    sourceRetailerFormat: offer.sourceRetailerFormat || '',
    sourceType: offer.sourceType || '',
    categoryPrimary: offer.categoryPrimary || '',
    categorySecondary: offer.categorySecondary || '',
    categoryKey: offer.categoryKey || '',
    subcategoryKey: offer.subcategoryKey || '',
    comparisonCategoryKey: offer.comparisonCategoryKey || '',
    categoryConfidence: Number(offer.categoryConfidence || 0),
    subcategoryConfidence: Number(offer.subcategoryConfidence || 0),
    searchText: searchTextSummary(offer.searchText),
    price: offer.priceCurrent?.amount ?? null,
    quantityText: offer.quantityText || '',
    validFrom: dateIso(offer.validFrom),
    validTo: dateIso(offer.validTo),
    sourceId: String(offer.sourceId || ''),
    sourceUrl: offer.sourceUrl || '',
    dedupeKey: offer.dedupeKey || '',
  };
}

function buildContextText(offer = {}) {
  return [
    offer.description,
    offer.rawFacts?.infoText,
    offer.rawFacts?.category,
    offer.rawFacts?.sourceCategory,
    offer.rawFacts?.productGroup,
    offer.rawFacts?.conditionsText,
  ].filter(Boolean).join(' ');
}

function buildReclassifiedFields(offer = {}, decision = {}) {
  const categoryPrimary = decision.primaryCategory || '';
  const categorySecondary = decision.secondaryCategory || '';
  const categoryKey = buildNormalizedKey(categorySecondary || categoryPrimary, 'unkategorisiert');
  const subcategoryKey = categorySecondary ? buildNormalizedKey(categorySecondary) : '';
  const comparisonCategoryKey = buildNormalizedKey(categorySecondary || categoryPrimary, '');
  const nextOffer = {
    ...offer,
    categoryPrimary,
    categorySecondary,
    categoryKey,
    subcategoryKey,
    comparisonCategoryKey,
    categoryConfidence: decision.categoryConfidence,
    subcategoryConfidence: decision.subcategoryConfidence,
  };

  return {
    categoryPrimary,
    categorySecondary,
    categoryKey,
    subcategoryKey,
    comparisonCategoryKey,
    categoryConfidence: decision.categoryConfidence,
    subcategoryConfidence: decision.subcategoryConfidence,
    searchText: createSearchTextFromOffer(nextOffer),
  };
}

function diffFields(before = {}, after = {}) {
  return [
    'categoryPrimary',
    'categorySecondary',
    'categoryKey',
    'subcategoryKey',
    'comparisonCategoryKey',
    'categoryConfidence',
    'subcategoryConfidence',
    'searchText',
  ].filter((field) => {
    if (field === 'categoryConfidence' || field === 'subcategoryConfidence') {
      return Number(before[field] || 0) !== Number(after[field] || 0);
    }

    return String(before[field] || '') !== String(after[field] || '');
  });
}

function planOfferReclassification(offer = {}) {
  const allowlistRules = matchedAllowlistRuleObjects(offer);
  const allowlistMatches = allowlistRules.map((rule) => rule.key);
  const before = summarizeOffer(offer);

  if (allowlistMatches.length === 0) {
    return {
      _id: before._id,
      title: before.title,
      allowlistMatches,
      before,
      after: before,
      status: 'skipped',
      reason: 'not allowlisted',
      changedFields: [],
      update: null,
    };
  }

  const decision = determineCategoryDecision({
    title: offer.title || '',
    contextText: buildContextText(offer),
    sourceCategory: offer.rawFacts?.category || offer.rawFacts?.sourceCategory || '',
  });

  if (
    decision.primaryCategory === 'Unkategorisiert'
    || !decision.primaryCategory
    || !decision.secondaryCategory
    || Number(decision.categoryConfidence || 0) < 0.55
  ) {
    return {
      _id: before._id,
      title: before.title,
      allowlistMatches,
      before,
      after: before,
      status: 'skipped',
      reason: 'low confidence / no safe category',
      changedFields: [],
      update: null,
      decision,
    };
  }

  if (!isAllowedProjectedTarget(allowlistRules, decision)) {
    return {
      _id: before._id,
      title: before.title,
      allowlistMatches,
      before,
      after: before,
      status: 'skipped',
      reason: 'projected category outside allowlist target',
      changedFields: [],
      update: null,
      decision,
    };
  }

  const update = buildReclassifiedFields(offer, decision);
  const after = summarizeOffer({ ...offer, ...update });
  const changedFields = diffFields(offer, update);
  const categoryChanged = changedFields.some((field) => [
    'categoryPrimary',
    'categorySecondary',
    'categoryKey',
    'subcategoryKey',
    'comparisonCategoryKey',
  ].includes(field));

  if (!categoryChanged) {
    return {
      _id: before._id,
      title: before.title,
      allowlistMatches,
      before,
      after,
      status: 'skipped',
      reason: 'unchanged',
      changedFields,
      update: null,
      decision,
    };
  }

  return {
    _id: before._id,
    title: before.title,
    allowlistMatches,
    before,
    after,
    status: 'planned',
    reason: 'category changed',
    changedFields,
    update,
    decision,
  };
}

function planHoferCategoryReclassification(offer = {}) {
  const before = summarizeOffer(offer);
  const profileMatches = isHoferOffer(offer);

  if (!profileMatches) {
    return {
      _id: before._id,
      title: before.title,
      allowlistMatches: [],
      profileMatches: false,
      before,
      after: before,
      status: 'skipped',
      reason: 'not hofer',
      changedFields: [],
      update: null,
    };
  }

  if (!isGenericOrWeakCategory(offer)) {
    return {
      _id: before._id,
      title: before.title,
      allowlistMatches: [HOFER_CATEGORY_PROFILE],
      profileMatches: true,
      before,
      after: before,
      status: 'skipped',
      reason: 'not weak category',
      changedFields: [],
      update: null,
    };
  }

  const decision = buildProjectedCategoryDecision(offer);
  const projectionReason = !isWeakProjection(decision)
    ? 'current classifier projects stronger category for weak hofer offer'
    : 'current classifier projection remains weak';

  if (isWeakProjection(decision)) {
    return {
      _id: before._id,
      title: before.title,
      allowlistMatches: [HOFER_CATEGORY_PROFILE],
      profileMatches: true,
      before,
      after: before,
      status: 'skipped',
      reason: 'low confidence / no safe category',
      changedFields: [],
      update: null,
      decision,
      confidence: decision.categoryConfidence,
      projectionReason,
    };
  }

  if (!hasSafeHoferProductSignal(offer)) {
    return {
      _id: before._id,
      title: before.title,
      allowlistMatches: [HOFER_CATEGORY_PROFILE],
      profileMatches: true,
      before,
      after: before,
      status: 'skipped',
      reason: 'low-confidence / no safe product signal',
      changedFields: [],
      update: null,
      decision,
      confidence: decision.categoryConfidence,
      projectionReason,
    };
  }

  if (isHoferDeviceOrToolOffer(offer) && !isSafeHoferDeviceToolTarget(decision)) {
    return {
      _id: before._id,
      title: before.title,
      allowlistMatches: [HOFER_CATEGORY_PROFILE],
      profileMatches: true,
      before,
      after: before,
      status: 'skipped',
      reason: 'no safe target category for device/tool',
      changedFields: [],
      update: null,
      decision,
      confidence: decision.categoryConfidence,
      projectionReason,
    };
  }

  if (!isAllowedHoferTarget(decision)) {
    return {
      _id: before._id,
      title: before.title,
      allowlistMatches: [HOFER_CATEGORY_PROFILE],
      profileMatches: true,
      before,
      after: before,
      status: 'skipped',
      reason: 'projected category outside allowed hofer targets',
      changedFields: [],
      update: null,
      decision,
      confidence: decision.categoryConfidence,
      projectionReason,
    };
  }

  const update = buildReclassifiedFields(offer, decision);
  const after = summarizeOffer({ ...offer, ...update });
  const changedFields = diffFields(offer, update);
  const categoryChanged = changedFields.some((field) => [
    'categoryPrimary',
    'categorySecondary',
    'categoryKey',
    'subcategoryKey',
    'comparisonCategoryKey',
  ].includes(field));

  if (!categoryChanged) {
    return {
      _id: before._id,
      title: before.title,
      allowlistMatches: [HOFER_CATEGORY_PROFILE],
      profileMatches: true,
      before,
      after,
      status: 'skipped',
      reason: 'unchanged',
      changedFields,
      update: null,
      decision,
      confidence: decision.categoryConfidence,
      projectionReason,
    };
  }

  return {
    _id: before._id,
    title: before.title,
    allowlistMatches: [HOFER_CATEGORY_PROFILE],
    profileMatches: true,
    sourceBucket: hoferSourceBucket(offer),
    sourceCategory: extractSourceCategory(offer),
    before,
    after,
    status: 'planned',
    reason: 'hofer weak category improved by current classifier',
    changedFields,
    update,
    decision,
    confidence: decision.categoryConfidence,
    projectionReason,
  };
}

function planOfferForProfile(offer = {}, options = {}) {
  if (isHoferCategoryProfile(options)) {
    return planHoferCategoryReclassification(offer);
  }

  return planOfferReclassification(offer);
}

function assertApplyAllowed({ apply = false, databaseName = '', plannedUpdateCount = 0, maxUpdates = DEFAULT_MAX_UPDATES } = {}) {
  if (!apply) {
    return { ok: true, dryRun: true };
  }

  if (databaseName !== DEVELOPMENT_DB_NAME) {
    throw new Error(`Refusing --apply: databaseName must be exactly ${DEVELOPMENT_DB_NAME}, got ${databaseName || 'unknown'}.`);
  }

  if (plannedUpdateCount > maxUpdates) {
    throw new Error(`Refusing --apply: planned updates ${plannedUpdateCount} exceed --max-updates=${maxUpdates}.`);
  }

  return { ok: true, dryRun: false };
}

function buildTargetQuery() {
  return {
    $or: ALLOWLIST_RULES.map((rule) => ({ title: rule.pattern })),
  };
}

async function loadTargetOffers({ offerModel = Offer, limit = DEFAULT_LIMIT } = {}) {
  const byId = new Map();

  for (const rule of ALLOWLIST_RULES) {
    const offers = await offerModel.find({ title: rule.pattern })
      .select(OFFER_SELECT_FIELDS)
      .sort({ retailerKey: 1, title: 1, updatedAt: -1 })
      .limit(limit)
      .lean();

    for (const offer of offers) {
      byId.set(String(offer._id || ''), offer);
    }
  }

  return [...byId.values()];
}

async function loadHoferCategoryTargetOffers({ offerModel = Offer, limit = HOFER_PROFILE_LIMIT } = {}) {
  return offerModel.find({
    $or: [
      { retailerKey: 'hofer' },
      { sourceRetailerFormat: /hofer/i },
      { retailerName: /hofer/i },
      { sourceRetailerName: /hofer/i },
    ],
  })
    .select(OFFER_SELECT_FIELDS)
    .sort({ sourceType: 1, categoryKey: 1, subcategoryKey: 1, title: 1, updatedAt: -1 })
    .limit(limit)
    .lean();
}

async function loadOffersForProfile({ offerModel = Offer, limit = DEFAULT_LIMIT, options = {} } = {}) {
  if (isHoferCategoryProfile(options)) {
    return loadHoferCategoryTargetOffers({ offerModel, limit });
  }

  return loadTargetOffers({ offerModel, limit });
}

async function applyPlannedUpdates({ offerModel = Offer, plans = [] } = {}) {
  const planned = plans.filter((plan) => plan.status === 'planned' && plan.update);
  let appliedUpdateCount = 0;

  for (const plan of planned) {
    const result = await offerModel.updateOne(
      { _id: plan._id },
      { $set: plan.update }
    );

    appliedUpdateCount += Number(result.modifiedCount || result.nModified || 0);
  }

  return { appliedUpdateCount };
}

function summarizePlans({ plans = [], databaseName = '', options = {}, startedAt = new Date(), finishedAt = new Date(), appliedUpdateCount = 0 } = {}) {
  const plannedUpdates = plans.filter((plan) => plan.status === 'planned');
  const skipped = plans.filter((plan) => plan.status === 'skipped');
  const skipReasons = countSkipReasons(skipped);
  const profile = options.profile || DEFAULT_PROFILE;

  return {
    checkedAt: finishedAt.toISOString(),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    databaseName,
    profile,
    dryRun: !options.apply,
    apply: Boolean(options.apply),
    matchedCount: plans.filter((plan) => isHoferCategoryProfile(options) ? plan.profileMatches : plan.allowlistMatches.length > 0).length,
    plannedUpdateCount: plannedUpdates.length,
    appliedUpdateCount,
    skippedCount: skipped.length,
    skipReasons,
    maxUpdates: options.maxUpdates,
    limit: options.limit,
    offers: plans.map((plan) => ({
      _id: plan._id,
      title: plan.title,
      retailerKey: plan.before.retailerKey,
      sourceRetailerFormat: plan.before.sourceRetailerFormat,
      sourceType: plan.before.sourceType,
      allowlistMatches: plan.allowlistMatches,
      profileMatches: Boolean(plan.profileMatches),
      status: plan.status,
      reason: plan.reason,
      confidence: plan.confidence ?? plan.decision?.categoryConfidence ?? null,
      projectionReason: plan.projectionReason || '',
      changedFields: plan.changedFields,
      before: plan.before,
      after: plan.after,
    })),
  };
}

function countSkipReasons(plans = []) {
  return plans.reduce((counts, plan) => {
    const reason = plan.reason || 'unknown';
    counts[reason] = (counts[reason] || 0) + 1;
    return counts;
  }, {});
}

async function buildRankingSnapshot({ queries = RANKING_QUERIES, rankingBuilder = buildOfferRanking } = {}) {
  const result = {};

  for (const query of queries) {
    const ranking = await rankingBuilder({ query, unit: 'all', limit: 10 });
    result[query] = {
      resultCount: ranking?.summary?.resultCount ?? null,
      displayedCount: ranking?.summary?.displayedCount ?? null,
      rankedOffers: (ranking?.rankedOffers || []).slice(0, 10).map((offer, index) => ({
        rank: index + 1,
        _id: String(offer._id || offer.id || ''),
        title: offer.title || '',
        retailerKey: offer.retailerKey || '',
        categoryPrimary: offer.categoryPrimary || '',
        categorySecondary: offer.categorySecondary || '',
        categoryKey: offer.categoryKey || '',
        subcategoryKey: offer.subcategoryKey || '',
        sourceType: offer.sourceType || '',
      })),
    };
  }

  return result;
}

function snapshotBasename(profile = DEFAULT_PROFILE) {
  return profile === HOFER_CATEGORY_PROFILE
    ? 'quality-hofer-reclassify'
    : 'quality-targeted-reclassify';
}

function writeSnapshots({ beforeSummary, afterSummary, diffSummary, dryRunSummary, profile = DEFAULT_PROFILE, outputDir = SNAPSHOT_DIR } = {}) {
  const basename = snapshotBasename(profile);
  fs.mkdirSync(path.join(process.cwd(), outputDir), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), outputDir, `${basename}-before.json`), JSON.stringify(beforeSummary, null, 2));
  fs.writeFileSync(path.join(process.cwd(), outputDir, `${basename}-after.json`), JSON.stringify(afterSummary, null, 2));
  fs.writeFileSync(path.join(process.cwd(), outputDir, `${basename}-diff.json`), JSON.stringify(diffSummary, null, 2));

  if (profile === HOFER_CATEGORY_PROFILE) {
    try {
      fs.writeFileSync(path.join(process.cwd(), outputDir, `${basename}-dry-run.json`), JSON.stringify(dryRunSummary || afterSummary, null, 2));
    } catch (error) {
      if (error.code !== 'EBUSY') {
        throw error;
      }
    }
  }
}

async function runTargetedReclassify({
  options = parseArgs(process.argv.slice(2)),
  offerModel = Offer,
  databaseName = mongoose.connection.name || env.MONGODB_DB_NAME,
  loadOffers = loadOffersForProfile,
  rankingBuilder = buildOfferRanking,
} = {}) {
  const startedAt = new Date();
  const rankingBefore = await buildRankingSnapshot({ rankingBuilder });
  const offers = await loadOffers({ offerModel, limit: options.limit, options });
  const plans = offers.map((offer) => planOfferForProfile(offer, options));
  const plannedUpdateCount = plans.filter((plan) => plan.status === 'planned').length;

  assertApplyAllowed({
    apply: options.apply,
    databaseName,
    plannedUpdateCount,
    maxUpdates: options.maxUpdates,
  });

  const beforeSummary = summarizePlans({
    plans,
    databaseName,
    options: { ...options, apply: false },
    startedAt,
    finishedAt: new Date(),
    appliedUpdateCount: 0,
  });
  beforeSummary.ranking = rankingBefore;

  let appliedUpdateCount = 0;
  if (options.apply && plannedUpdateCount > 0) {
    ({ appliedUpdateCount } = await applyPlannedUpdates({ offerModel, plans }));
    clearRankingResponseCache();
  }

  const rankingAfter = options.apply
    ? await buildRankingSnapshot({ rankingBuilder })
    : rankingBefore;
  const finishedAt = new Date();
  const afterSummary = summarizePlans({
    plans,
    databaseName,
    options,
    startedAt,
    finishedAt,
    appliedUpdateCount,
  });
  afterSummary.ranking = rankingAfter;

  const diffSummary = {
    checkedAt: finishedAt.toISOString(),
    databaseName,
    profile: options.profile || DEFAULT_PROFILE,
    dryRun: !options.apply,
    apply: Boolean(options.apply),
    matchedCount: afterSummary.matchedCount,
    plannedUpdateCount,
    appliedUpdateCount,
    skippedCount: afterSummary.skippedCount,
    skipReasons: afterSummary.skipReasons,
    changedOffers: plans
      .filter((plan) => plan.status === 'planned')
      .map((plan) => ({
        _id: plan._id,
        title: plan.title,
        retailerKey: plan.before.retailerKey,
        sourceRetailerFormat: plan.before.sourceRetailerFormat,
        sourceType: plan.before.sourceType,
        allowlistMatches: plan.allowlistMatches,
        changedFields: plan.changedFields,
        before: plan.before,
        after: plan.after,
        reason: plan.reason,
        confidence: plan.confidence ?? plan.decision?.categoryConfidence ?? null,
        projectionReason: plan.projectionReason || '',
      })),
    skippedOffers: plans
      .filter((plan) => plan.status === 'skipped')
      .map((plan) => ({
        _id: plan._id,
        title: plan.title,
        retailerKey: plan.before.retailerKey,
        sourceRetailerFormat: plan.before.sourceRetailerFormat,
        sourceType: plan.before.sourceType,
        allowlistMatches: plan.allowlistMatches,
        reason: plan.reason,
        confidence: plan.confidence ?? plan.decision?.categoryConfidence ?? null,
        projectionReason: plan.projectionReason || '',
      })),
    rankingBefore,
    rankingAfter,
  };

  if (options.writeSnapshots) {
    writeSnapshots({
      beforeSummary,
      afterSummary,
      diffSummary,
      dryRunSummary: {
        ok: true,
        databaseName,
        profile: options.profile || DEFAULT_PROFILE,
        dryRun: !options.apply,
        apply: Boolean(options.apply),
        matchedCount: afterSummary.matchedCount,
        plannedUpdateCount,
        appliedUpdateCount,
        skippedCount: afterSummary.skippedCount,
        skipReasons: afterSummary.skipReasons,
        diffSummary,
      },
      profile: options.profile || DEFAULT_PROFILE,
    });
  }

  return {
    ok: true,
    databaseName,
    profile: options.profile || DEFAULT_PROFILE,
    dryRun: !options.apply,
    apply: Boolean(options.apply),
    matchedCount: afterSummary.matchedCount,
    plannedUpdateCount,
    appliedUpdateCount,
    skippedCount: afterSummary.skippedCount,
    skipReasons: afterSummary.skipReasons,
    snapshotsWritten: Boolean(options.writeSnapshots),
    beforeSummary,
    afterSummary,
    diffSummary,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await connectToDatabase();

  const result = await runTargetedReclassify({
    options,
    databaseName: mongoose.connection.name || env.MONGODB_DB_NAME,
  });

  const output = options.json
    ? result
    : {
        ok: result.ok,
        databaseName: result.databaseName,
        profile: result.profile,
        dryRun: result.dryRun,
        apply: result.apply,
        matchedCount: result.matchedCount,
        plannedUpdateCount: result.plannedUpdateCount,
        appliedUpdateCount: result.appliedUpdateCount,
        skippedCount: result.skippedCount,
        skipReasons: result.skipReasons,
        snapshotsWritten: result.snapshotsWritten,
      };

  console.log(JSON.stringify(output, null, 2));
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(JSON.stringify({
        ok: false,
        message: error.message,
        stack: error.stack,
      }, null, 2));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}

module.exports = {
  ALLOWLIST_RULES,
  DEVELOPMENT_DB_NAME,
  DEFAULT_PROFILE,
  HOFER_ALLOWED_TARGETS,
  HOFER_CATEGORY_PROFILE,
  RANKING_QUERIES,
  assertApplyAllowed,
  buildNormalizedKey,
  buildReclassifiedFields,
  buildTargetQuery,
  createSearchTextFromOffer,
  diffFields,
  hasSafeHoferProductSignal,
  isAllowedHoferTarget,
  matchedAllowlistRules,
  isAllowedProjectedTarget,
  isHoferOffer,
  loadHoferCategoryTargetOffers,
  parseArgs,
  planHoferCategoryReclassification,
  planOfferReclassification,
  runTargetedReclassify,
  summarizeOffer,
  summarizePlans,
};
