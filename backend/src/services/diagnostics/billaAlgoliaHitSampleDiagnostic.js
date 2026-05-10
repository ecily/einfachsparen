const DEFAULT_HITS_PER_RETAILER = 8;
const ALGOLIA_ENDPOINT = 'https://1L8FZ3LLKJ-dsn.algolia.net/1/indexes/prod_product_search/query';
const ALGOLIA_HEADERS = {
  'X-Algolia-API-Key': '4872917f97ea7474bd5a4efd496e16fb',
  'X-Algolia-Application-Id': '1L8FZ3LLKJ',
  'Content-Type': 'application/json',
};

const TARGET_RETAILERS = [
  { retailerKey: 'billa', displayName: 'BILLA' },
  { retailerKey: 'billa-plus', displayName: 'BILLA PLUS' },
];

const VALIDITY_PATH_PATTERN = /(^|\.)(valid|validity|validFrom|validTo|start|end|date|from|to|promotion|campaign|offer|legal|disclaimer|gueltig|gültig|bis|von)(\.|$)/i;
const VALIDITY_TEXT_PATTERN = /\b(valid|validity|gueltig|gültig|aktion|promotion|campaign|legal|disclaimer|bis|von|ab)\b/i;
const EXPLICIT_PATH_PATTERN = /(^|\.)(validFrom|validTo|validityFrom|validityTo|startDate|endDate|offerStartDate|offerEndDate|activeFrom|activeTo|visibleFrom|visibleTo|promotionStart|promotionEnd|from|to|start|end)(\.|$)/i;
const CAMPAIGN_PATH_PATTERN = /(^|\.)(campaign|promotion|offer|aktion)(\.|$)/i;
const LEGAL_PATH_PATTERN = /(^|\.)(legal|disclaimer|terms|condition|conditions)(\.|$)/i;

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

function valueKind(value) {
  if (value === null || value === undefined) return 'unknown';
  if (Array.isArray(value)) return 'array';
  if (value instanceof Date) return 'date';
  if (typeof value === 'object') return 'object';
  if (hasDateToken(value)) return 'date';
  if (typeof value === 'string') return 'text';
  return 'unknown';
}

function hasDateToken(value) {
  const text = stringify(value);
  return /\b20\d{2}-\d{2}-\d{2}\b/.test(text)
    || /\b\d{1,2}\.\d{1,2}\.(?:20\d{2})?\b/.test(text)
    || /\b\d{2}-\d{2}-20\d{2}\b/.test(text);
}

function walkFields(value, prefix = '', output = [], { maxArrayItems = 10 } = {}) {
  if (value === null || value === undefined) return output;

  if (value instanceof Date || ['string', 'number', 'boolean'].includes(typeof value)) {
    output.push({ path: prefix, value });
    return output;
  }

  if (Array.isArray(value)) {
    output.push({ path: prefix, value });
    value.slice(0, maxArrayItems).forEach((item, index) => {
      walkFields(item, prefix ? `${prefix}.${index}` : String(index), output, { maxArrayItems });
    });
    return output;
  }

  if (typeof value === 'object') {
    output.push({ path: prefix, value });
    Object.entries(value).forEach(([key, nested]) => {
      walkFields(nested, prefix ? `${prefix}.${key}` : key, output, { maxArrayItems });
    });
  }

  return output;
}

function findPossibleValidityFields(hit = {}) {
  return walkFields(hit)
    .filter((field) => field.path)
    .filter((field) => VALIDITY_PATH_PATTERN.test(field.path) || VALIDITY_TEXT_PATTERN.test(stringify(field.value)))
    .map((field) => ({
      path: field.path,
      sampleValue: truncate(field.value),
      kind: valueKind(field.value),
      hasDate: hasDateToken(field.value),
      explicitPerHitCandidate: EXPLICIT_PATH_PATTERN.test(field.path) && hasDateToken(field.value),
      campaignLevelCandidate: CAMPAIGN_PATH_PATTERN.test(field.path),
      legalTextCandidate: LEGAL_PATH_PATTERN.test(field.path) || /legal|disclaimer|bedingungen|gueltig|gültig/i.test(stringify(field.value)),
    }))
    .filter((field, index, fields) =>
      fields.findIndex((candidate) => candidate.path === field.path && candidate.sampleValue === field.sampleValue) === index
    );
}

function classifyValidityEvidence(fields = []) {
  if (fields.some((field) => field.explicitPerHitCandidate)) {
    return 'explicit-per-hit-validity-present';
  }

  const dateFields = fields.filter((field) => field.hasDate);

  if (dateFields.some((field) => field.campaignLevelCandidate)) {
    return 'campaign-level-validity-only';
  }

  if (fields.some((field) => field.legalTextCandidate)) {
    return 'legal-text-validity-only';
  }

  if (fields.length === 0) {
    return 'no-validity-evidence';
  }

  return 'unclear';
}

function shapePrice(hit = {}) {
  const regular = hit?.price?.regular?.value;
  const crossed = hit?.price?.crossed;
  const loyalty = hit?.price?.loyalty?.value;

  return {
    regular: Number.isFinite(Number(regular)) ? Number((Number(regular) / 100).toFixed(2)) : null,
    crossed: Number.isFinite(Number(crossed)) ? Number((Number(crossed) / 100).toFixed(2)) : null,
    loyalty: Number.isFinite(Number(loyalty)) ? Number((Number(loyalty) / 100).toFixed(2)) : null,
    regularPromotionText: truncate(hit?.price?.regular?.promotionText || '', 120),
    loyaltyPromotionText: truncate(hit?.price?.loyalty?.promotionText || '', 120),
  };
}

function shapeSampleHit(hit = {}) {
  const fields = findPossibleValidityFields(hit);

  return {
    objectID: String(hit.objectID || ''),
    sku: String(hit.sku || ''),
    name: truncate(hit.name || '', 120),
    brand: truncate(hit.brand?.name || '', 80),
    category: truncate(hit.category || '', 120),
    inPromotion: Boolean(hit.inPromotion),
    price: shapePrice(hit),
    topLevelKeys: Object.keys(hit).sort(),
    possibleValiditySnippets: fields.slice(0, 12).map((field) => ({
      path: field.path,
      sampleValue: field.sampleValue,
      kind: field.kind,
      hasDate: field.hasDate,
      explicitPerHitCandidate: field.explicitPerHitCandidate,
      campaignLevelCandidate: field.campaignLevelCandidate,
      legalTextCandidate: field.legalTextCandidate,
    })),
  };
}

function analyzeHits({ retailerKey, hits = [] } = {}) {
  const possibleValidityFields = hits.flatMap(findPossibleValidityFields);
  const dedupedFields = possibleValidityFields.filter((field, index, fields) =>
    fields.findIndex((candidate) => candidate.path === field.path && candidate.sampleValue === field.sampleValue) === index
  );

  return {
    retailerKey,
    sampleHitCount: hits.length,
    topLevelKeys: unique(hits.flatMap((hit) => Object.keys(hit || {}))).sort(),
    possibleValidityFields: dedupedFields.slice(0, 80).map((field) => ({
      path: field.path,
      sampleValue: field.sampleValue,
      kind: field.kind,
    })),
    sampleHitsShaped: hits.slice(0, DEFAULT_HITS_PER_RETAILER).map(shapeSampleHit),
    classification: classifyValidityEvidence(dedupedFields),
  };
}

async function fetchAlgoliaHitSample({
  fetchImpl = globalThis.fetch,
  hitsPerRetailer = DEFAULT_HITS_PER_RETAILER,
  timeoutMs = 8000,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is not available in this Node runtime');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(ALGOLIA_ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: ALGOLIA_HEADERS,
      body: JSON.stringify({
        query: '',
        page: 0,
        hitsPerPage: Math.max(1, Math.min(Number(hitsPerRetailer || DEFAULT_HITS_PER_RETAILER), 10)),
        filters: 'inPromotion:true',
      }),
    });

    const text = await response.text();
    let body = {};

    try {
      body = JSON.parse(text);
    } catch {
      body = { parseError: truncate(text, 500) };
    }

    if (!response.ok) {
      throw new Error(`Algolia request failed with HTTP ${response.status}: ${truncate(body?.message || text, 240)}`);
    }

    return {
      ok: true,
      status: response.status,
      hits: Array.isArray(body.hits) ? body.hits : [],
      nbHits: body.nbHits ?? null,
      page: body.page ?? 0,
      hitsPerPage: body.hitsPerPage ?? null,
      exhaustiveNbHits: body.exhaustiveNbHits ?? null,
    };
  } finally {
    clearTimeout(timer);
  }
}

function recommendedNextAction(retailers = []) {
  const classifications = unique(retailers.map((retailer) => retailer.classification));

  if (classifications.includes('explicit-per-hit-validity-present')) {
    return 'Next fix block may inspect exact explicit date paths and add conservative parser mapping with regression tests.';
  }

  if (classifications.includes('campaign-level-validity-only') || classifications.includes('legal-text-validity-only')) {
    return 'Do not map Offer.validTo yet; first store campaign/legal evidence separately and prove per-offer applicability.';
  }

  if (classifications.every((classification) => classification === 'no-validity-evidence')) {
    return 'A direct validTo parser fix is not currently justified from Algolia hits; keep snapshot validity honest and look for another official flyer/campaign source.';
  }

  return 'Keep parser unchanged; inspect the ambiguous fields manually before any productive mapping.';
}

async function buildBillaAlgoliaHitSampleDiagnostic({
  generatedAt = new Date(),
  fetchImpl = globalThis.fetch,
  hitsPerRetailer = DEFAULT_HITS_PER_RETAILER,
  timeoutMs = 8000,
} = {}) {
  const retailers = [];
  let fetchError = null;
  let fetchMeta = {};

  try {
    const sample = await fetchAlgoliaHitSample({ fetchImpl, hitsPerRetailer, timeoutMs });
    fetchMeta = {
      ok: sample.ok,
      status: sample.status,
      nbHits: sample.nbHits,
      page: sample.page,
      hitsPerPage: sample.hitsPerPage,
      exhaustiveNbHits: sample.exhaustiveNbHits,
    };

    for (const retailer of TARGET_RETAILERS) {
      retailers.push(analyzeHits({
        retailerKey: retailer.retailerKey,
        hits: sample.hits.slice(0, Math.max(1, Math.min(Number(hitsPerRetailer || DEFAULT_HITS_PER_RETAILER), 10))),
      }));
    }
  } catch (error) {
    fetchError = {
      message: error.message,
      name: error.name,
    };

    for (const retailer of TARGET_RETAILERS) {
      retailers.push({
        retailerKey: retailer.retailerKey,
        sampleHitCount: 0,
        topLevelKeys: [],
        possibleValidityFields: [],
        sampleHitsShaped: [],
        classification: 'unclear',
      });
    }
  }

  const explicitPerHitValidityFieldsFound = unique(retailers.flatMap((retailer) =>
    retailer.sampleHitsShaped.flatMap((hit) =>
      hit.possibleValiditySnippets
        .filter((field) => field.explicitPerHitCandidate)
        .map((field) => field.path)
    )
  ));

  return {
    ok: !fetchError,
    readOnly: true,
    liveHttpChecked: !fetchError,
    mutatedCollections: [],
    generatedAt: generatedAt instanceof Date ? generatedAt.toISOString() : generatedAt,
    principle: 'Qualitaet der Daten ist kein Nebenthema - sie IST das Produkt.',
    diagnosticOnly: true,
    fetchMeta,
    fetchError,
    summary: {
      billaClassification: retailers.find((retailer) => retailer.retailerKey === 'billa')?.classification || 'unclear',
      billaPlusClassification: retailers.find((retailer) => retailer.retailerKey === 'billa-plus')?.classification || 'unclear',
      explicitPerHitValidityFieldsFound,
      recommendedNextAction: recommendedNextAction(retailers),
    },
    retailers,
  };
}

module.exports = {
  DEFAULT_HITS_PER_RETAILER,
  buildBillaAlgoliaHitSampleDiagnostic,
  classifyValidityEvidence,
  fetchAlgoliaHitSample,
  findPossibleValidityFields,
  shapeSampleHit,
  truncate,
};
