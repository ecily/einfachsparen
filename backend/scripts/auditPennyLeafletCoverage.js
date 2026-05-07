const fs = require('node:fs/promises');
const path = require('node:path');
const mongoose = require('mongoose');

process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';

const { connectToDatabase } = require('../src/config/mongodb');
const Offer = require('../src/models/Offer');
const Source = require('../src/models/Source');
const RawDocument = require('../src/models/RawDocument');
const CrawlJob = require('../src/models/CrawlJob');
const { normalizeTitleForMatch } = require('../src/services/crawl/sourceEvidence');
const {
  extractPennyPdfReference: extractSharedPennyPdfReference,
} = require('../src/services/crawl/pennyPdfLeafletParser');

const DEFAULT_PDF_PATH = path.join(
  process.env.USERPROFILE || '',
  'Downloads',
  'Digitales_Flugblatt_PP_KW19.pdf'
);
const DEFAULT_EXAMPLES = 15;

const STOP_WORDS = new Set([
  'ab',
  'aktion',
  'angebot',
  'artikel',
  'bei',
  'bis',
  'der',
  'die',
  'das',
  'den',
  'dem',
  'des',
  'div',
  'ein',
  'eine',
  'einer',
  'extra',
  'fl',
  'fuer',
  'gratis',
  'gueltig',
  'info',
  'je',
  'kg',
  'l',
  'liter',
  'mit',
  'nur',
  'od',
  'oder',
  'packung',
  'penny',
  'pro',
  'sa',
  'sorten',
  'statt',
  'stueck',
  'stk',
  'und',
  'von',
  'zum',
]);

const NON_OFFER_PATTERNS = [
  /penny\.at/i,
  /unsere statt-preise/i,
  /teilnahmebedingungen/i,
  /nicht in bar/i,
  /druck- und satzfehler/i,
  /solange der vorrat reicht/i,
  /zzgl\./i,
  /einwegpfand/i,
  /^seite\s+\d+/i,
  /^info fehlt$/i,
  /^supaaa/i,
  /^guenstig/i,
  /^günstig/i,
  /^da schau her/i,
  /^wochenend/i,
  /^wochen starter/i,
  /^muttertag$/i,
];

function parseArgs(argv) {
  const options = {
    pdfPath: '',
    examples: DEFAULT_EXAMPLES,
    format: 'json',
    output: '',
  };

  for (const arg of argv) {
    if (arg === '--markdown' || arg === '--md') {
      options.format = 'markdown';
      continue;
    }

    if (arg === '--json') {
      options.format = 'json';
      continue;
    }

    if (arg.startsWith('--examples=')) {
      const value = Number(arg.slice('--examples='.length));

      if (Number.isInteger(value) && value >= 1 && value <= 100) {
        options.examples = value;
      }
      continue;
    }

    if (arg.startsWith('--output=')) {
      options.output = path.resolve(arg.slice('--output='.length));
      continue;
    }

    if (!options.pdfPath) {
      options.pdfPath = arg;
    }
  }

  options.pdfPath = path.resolve(options.pdfPath || DEFAULT_PDF_PATH);
  return options;
}

function sanitizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function dateKey(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function parseNumericAmount(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value);
  const wholeEuroMatch = text.match(/\b(\d{1,4})\.-(?!\d)/);

  if (wholeEuroMatch) {
    const amount = Number(wholeEuroMatch[1]);
    return Number.isFinite(amount) ? amount : null;
  }

  const match = text.match(/(\d{1,3})[,.](\d{2})(?!\d)/);

  if (!match) {
    return null;
  }

  const amount = Number(`${match[1]}.${match[2]}`);
  return Number.isFinite(amount) ? amount : null;
}

function hasPriceSignal(line) {
  const text = String(line || '');

  if (/g(?:ue|ü)ltig/i.test(text) && /\b\d{1,2}\.\d{1,2}\./.test(text)) {
    return /\b\d{1,4}\.-(?!\d)/.test(text);
  }

  return /\b\d{1,3}[,.]\d{2}\b/.test(text)
    || /^\d{1,3}[,.]\d{2}(?!\d)/.test(text)
    || /\b\d{1,4}\.-(?!\d)/.test(text);
}

function hasUnitPriceSignal(line) {
  return /\b\d+(?:[,.]\d+)?\s*(?:kg|g|l|ml|cl|stk|stueck|stück)\s*=/.test(line)
    || /(?:kg|g|l|ml|cl|stk|stueck|stück)\s*\/?\s*\d{1,3}[,.]\d{2}/i.test(line);
}

function hasSavingsSignal(line) {
  return /gespart|vergleich zum einzelverkauf/i.test(line);
}

function hasOfferPriceSignal(line) {
  return hasPriceSignal(line) && !hasUnitPriceSignal(line) && !hasSavingsSignal(line);
}

function hasStandaloneConditionSignal(line) {
  return /gutschein|jö|joe|app|karte/i.test(line) && !hasOfferPriceSignal(line);
}

function hasMechanicSignal(line) {
  return /(\d+\s*\+\s*\d+|gratis|ab\s+\d+\s+(?:fl|flaschen|stk|stueck|stück)|bei\s+\d+\s+(?:fl|pkg|stk)|gutschein|jö|joe|app|karte|-?\d{1,2}\s*%)/i.test(line);
}

function normalizeForAudit(value) {
  return normalizeTitleForMatch(value)
    .replace(/\bjo\b/g, 'joe')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenList(value) {
  return normalizeForAudit(value)
    .split(/\s+/)
    .filter((token) => token.length >= 3)
    .filter((token) => !STOP_WORDS.has(token))
    .filter((token) => !/^\d+$/.test(token));
}

function tokenSet(value) {
  return new Set(tokenList(value));
}

function jaccard(left, right) {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;

  return union > 0 ? intersection / union : 0;
}

function isMostlyUppercaseText(line) {
  const letters = line.replace(/[^A-Za-zÄÖÜäöüß]/g, '');

  if (letters.length < 3) {
    return false;
  }

  const uppercase = letters.replace(/[^A-ZÄÖÜ]/g, '').length;
  return uppercase / letters.length >= 0.65;
}

function isNoiseLine(line) {
  const text = sanitizeWhitespace(line);

  if (!text || text.length < 3) {
    return true;
  }

  if (NON_OFFER_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }

  if (/^[\d\s.,€%-]+$/.test(text)) {
    return true;
  }

  if (/^\+?\d+\s*treuepunkt/i.test(text)) {
    return true;
  }

  if (/^[a-zäöüß]\s*$/i.test(text)) {
    return true;
  }

  return false;
}

function isProductishLine(line) {
  if (isNoiseLine(line) || hasPriceSignal(line)) {
    return false;
  }

  const normalized = normalizeForAudit(line);

  if (!/[a-z]/.test(normalized)) {
    return false;
  }

  if (/^(kl|klasse|pro|preis|im vergleich|gespart|nur kurze zeit|gueltig|gültig)\b/i.test(line)) {
    return false;
  }

  return isMostlyUppercaseText(line)
    || /\b\d+(?:[,.]\d+)?\s*(?:g|kg|ml|l|stk|stueck|stück|cm)\b/i.test(line)
    || /\bod\.?|oder|div\.|versch\.|sorten\b/i.test(line);
}

function extractDatesFromText(text) {
  const fullDates = [...text.matchAll(/\b(\d{1,2})\.(\d{1,2})\.(20\d{2})\b/g)].map((match) => ({
    day: Number(match[1]),
    month: Number(match[2]),
    year: Number(match[3]),
  }));
  const year = fullDates[0]?.year || new Date().getFullYear();
  const shortDates = [...text.matchAll(/\b(\d{1,2})\.(\d{1,2})\.(?!\d)/g)].map((match) => ({
    day: Number(match[1]),
    month: Number(match[2]),
    year,
  }));
  const dates = [...fullDates, ...shortDates]
    .map((item) => new Date(Date.UTC(item.year, item.month - 1, item.day, 12, 0, 0)))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((left, right) => left.getTime() - right.getTime());
  const unique = [];

  for (const date of dates) {
    if (!unique.some((item) => item.getTime() === date.getTime())) {
      unique.push(date);
    }
  }

  return unique;
}

function deriveLeafletValidity(pages) {
  const text = pages.map((page) => page.text).join('\n');
  const explicitRange = text.match(/Gültig\s+von\s+(\d{1,2}\.\d{1,2}\.20\d{2})\s+bis\s+(\d{1,2}\.\d{1,2}\.20\d{2})/i)
    || text.match(/Gueltig\s+von\s+(\d{1,2}\.\d{1,2}\.20\d{2})\s+bis\s+(\d{1,2}\.\d{1,2}\.20\d{2})/i);

  if (explicitRange) {
    const dates = extractDatesFromText(explicitRange[0]);

    return {
      validFrom: dates[0] || null,
      validTo: dates[dates.length - 1] || null,
      detectedDates: dates.map(dateKey),
    };
  }

  const firstPageDates = extractDatesFromText(pages[0]?.text || '');
  const dates = firstPageDates.length >= 2 ? firstPageDates : extractDatesFromText(text);

  return {
    validFrom: dates[0] || null,
    validTo: dates[dates.length - 1] || null,
    detectedDates: dates.map(dateKey),
  };
}

function extractQuantityText(lines) {
  const quantityLines = lines.filter((line) =>
    /\b(\d+(?:[,.]\d+)?\s*(?:g|kg|ml|l|stk|stueck|stück|flaschen|fl|pkg|packung)|\d+\s*x\s*\d+(?:[,.]\d+)?\s*(?:g|kg|ml|l))\b/i.test(line)
  );

  return sanitizeWhitespace(quantityLines.join(' / ')).slice(0, 180);
}

function classifyCandidate(candidate) {
  const tokens = tokenList(candidate.title);
  const normalizedTitle = normalizeForAudit(candidate.title);
  const normalizedText = normalizeForAudit(`${candidate.title} ${candidate.conditionsText} ${candidate.rawText}`);

  if (candidate.price && candidate.price <= 0.5 && /\b(zzgl|einwegpfand|pfand pro flasche|pfand pro dose)\b/i.test(normalizedText)) {
    return 'deposit-footnote-fragment';
  }

  if (tokens.length < 2 && !candidate.price && !candidate.conditionsText) {
    return 'parser-noise';
  }

  if (!candidate.price && /\b(newsletter|whatsapp|penny app|appklusiv|angebote aktionen|digitale joe karte|einkaufsliste|filialfinder|jetzt downloaden|jetzt abonnieren)\b/i.test(normalizedText)) {
    return 'app-or-newsletter-promo';
  }

  if (!candidate.price && /\b(gewinnspiel|gluecksrad|jetzt gewinnen|preise reise|tolle games)\b/i.test(normalizedText)) {
    return 'contest-or-campaign';
  }

  if (!candidate.price && /\b(so schmeckt|magazin|rezept|rezept tipps|griller|personen|garzeit|zutaten|olivenoel|petersilienoel)\b/i.test(normalizedText)) {
    return 'recipe-or-magazine';
  }

  if (!candidate.price && /\b(joe|oes|oesterreich|guthaben|sammelmonat|einkaufsbonus|mit joe bei penny)\b/i.test(normalizedText)) {
    return 'loyalty-campaign';
  }

  if (!candidate.price && /\b(spenden|nachhaltig|nachhaltigkeit|pfandtragetasche)\b/i.test(normalizedText)) {
    return 'sustainability-or-donation-text';
  }

  if (!candidate.price && /\b(gutscheinkarten|gutschein karte|zalando|gratis einkauf)\b/i.test(normalizedText)) {
    return 'voucher-or-campaign';
  }

  if (/gutschein|gratis-einkauf|ös|oes/i.test(candidate.title) && !candidate.price) {
    return 'voucher-or-campaign';
  }

  if (!candidate.price && !candidate.conditionsText) {
    return 'weak-no-price';
  }

  return '';
}

function buildCandidate({ pageNumber, titleLines, contextLines, priceLine, index }) {
  const title = sanitizeWhitespace(titleLines.join(' ')).replace(/\*/g, '');
  const conditions = contextLines.filter(hasMechanicSignal);
  const price = parseNumericAmount(priceLine || contextLines.find(hasOfferPriceSignal));
  const quantityText = extractQuantityText([...titleLines, ...contextLines]);
  const rawText = sanitizeWhitespace([...titleLines, ...contextLines].join(' '));
  const candidate = {
    id: `p${pageNumber}-${index}`,
    page: pageNumber,
    title,
    titleNormalized: normalizeForAudit(title),
    price,
    quantityText,
    conditionsText: sanitizeWhitespace(conditions.join(' / ')),
    rawText: rawText.slice(0, 500),
  };
  const exclusionReason = classifyCandidate(candidate);

  if (exclusionReason) {
    candidate.exclusionReason = exclusionReason;
  }

  return candidate;
}

function extractCandidatesFromPage(page) {
  const rawLines = page.text
    .split(/\r?\n/)
    .map(sanitizeWhitespace)
    .filter(Boolean);
  const candidates = [];
  const seen = new Set();

  for (let index = 0; index < rawLines.length; index += 1) {
    const line = rawLines[index];

    if (!hasOfferPriceSignal(line) && !hasStandaloneConditionSignal(line)) {
      continue;
    }

    const lookback = rawLines.slice(Math.max(0, index - 9), index);
    const titleLines = [];

    for (let inner = lookback.length - 1; inner >= 0; inner -= 1) {
      const candidateLine = lookback[inner];

      if (titleLines.length >= 5) {
        break;
      }

      if (hasOfferPriceSignal(candidateLine)) {
        break;
      }

      if (isProductishLine(candidateLine)) {
        titleLines.unshift(candidateLine);
        continue;
      }

      if (titleLines.length > 0 && hasMechanicSignal(candidateLine)) {
        continue;
      }
    }

    if (titleLines.length === 0) {
      continue;
    }

    const contextLines = rawLines.slice(index, Math.min(rawLines.length, index + 5));
    const candidate = buildCandidate({
      pageNumber: page.page,
      titleLines,
      contextLines,
      priceLine: hasOfferPriceSignal(line) ? line : '',
      index: candidates.length + 1,
    });
    const key = [
      candidate.titleNormalized,
      candidate.price ?? '',
      candidate.conditionsText,
    ].join('::');

    if (!seen.has(key)) {
      seen.add(key);
      candidates.push(candidate);
    }
  }

  return candidates;
}

async function extractPdfReference(pdfPath) {
  const data = await fs.readFile(pdfPath);
  const reference = await extractSharedPennyPdfReference({
    pdfBuffer: data,
    pdfPath,
  });

  return {
    ...reference,
    file: {
      ...reference.file,
      path: pdfPath,
    },
  };
}

function buildDbOfferQuery(validity) {
  const overlap = [];

  if (validity.validFrom && validity.validTo) {
    overlap.push({
      $and: [
        {
          $or: [
            { validFrom: null },
            { validFrom: { $lte: validity.validTo } },
          ],
        },
        {
          $or: [
            { validTo: null },
            { validTo: { $gte: validity.validFrom } },
          ],
        },
      ],
    });
  }

  return {
    retailerKey: 'penny',
    $or: [
      ...overlap,
      { isActiveNow: true },
      { isActiveToday: true },
      { status: { $in: ['active', 'upcoming', 'unknown'] } },
    ],
  };
}

async function loadDbContext(validity) {
  const offerQuery = buildDbOfferQuery(validity);
  const [offers, sources, rawDocuments, crawlJobs] = await Promise.all([
    Offer.find(offerQuery)
      .sort({ validFrom: 1, title: 1 })
      .select([
        '_id',
        'retailerKey',
        'retailerName',
        'title',
        'titleNormalized',
        'brand',
        'description',
        'searchText',
        'quantityText',
        'priceCurrent',
        'validFrom',
        'validTo',
        'status',
        'sourceType',
        'sourceUrl',
        'conditionsText',
        'customerProgramRequired',
        'isMultiBuy',
        'effectiveDiscountType',
        'categoryPrimary',
        'categorySecondary',
        'quality',
        'rawFacts',
      ].join(' '))
      .lean(),
    Source.find({ retailerKey: 'penny' })
      .sort({ channel: 1, sourceUrl: 1 })
      .select('retailerKey retailerName channel label sourceUrl sourceType enabled active latestStatus latestRunAt capabilities notes disabledReason')
      .lean(),
    RawDocument.find({ retailerKey: 'penny' })
      .sort({ fetchedAt: -1 })
      .limit(10)
      .select('documentType sourceType url canonicalUrl title fetchedAt foundRawItems parsedOffers rejectedOffers parserVersion payload')
      .lean(),
    CrawlJob.find({ retailerKey: 'penny' })
      .sort({ startedAt: -1 })
      .limit(10)
      .select('status trigger startedAt finishedAt sourceType sourceUrl parserVersion stats warningMessages errorMessages metadata')
      .lean(),
  ]);

  return {
    offerQuery,
    offers,
    sources,
    rawDocuments,
    crawlJobs,
  };
}

function offerText(offer) {
  return normalizeForAudit([
    offer.brand,
    offer.title,
    offer.titleNormalized,
    offer.description,
    offer.searchText,
    offer.quantityText,
    offer.conditionsText,
    offer.categoryPrimary,
    offer.categorySecondary,
  ].filter(Boolean).join(' '));
}

function scoreMatch(candidate, offer, validity) {
  const candidateText = normalizeForAudit([
    candidate.title,
    candidate.quantityText,
    candidate.conditionsText,
  ].filter(Boolean).join(' '));
  const dbText = offerText(offer);
  const candidateTokens = tokenSet(candidateText);
  const offerTokens = tokenSet(dbText);
  const tokenScore = jaccard(candidateTokens, offerTokens);
  const candidateTitle = normalizeForAudit(candidate.title);
  const dbTitle = normalizeForAudit(`${offer.brand || ''} ${offer.title || ''}`);
  const containmentScore =
    candidateTitle.length >= 8 && dbText.includes(candidateTitle) ? 0.35
      : dbTitle.length >= 8 && candidateText.includes(dbTitle) ? 0.3
        : 0;
  const priceCurrent = Number(offer.priceCurrent?.amount);
  const priceScore = candidate.price && Number.isFinite(priceCurrent)
    ? Math.abs(candidate.price - priceCurrent) <= 0.02 ? 0.3 : Math.abs(candidate.price - priceCurrent) <= 0.25 ? 0.08 : -0.12
    : 0;
  const quantityScore = candidate.quantityText
    ? jaccard(tokenSet(candidate.quantityText), tokenSet(offer.quantityText || '')) * 0.18
    : 0;
  const validityScore = offer.validFrom || offer.validTo
    ? hasValidityOverlap(offer, validity) ? 0.12 : -0.08
    : 0;
  const conditionScore = candidate.conditionsText && offer.conditionsText
    ? jaccard(tokenSet(candidate.conditionsText), tokenSet(offer.conditionsText)) * 0.1
    : 0;
  const score = tokenScore + containmentScore + priceScore + quantityScore + validityScore + conditionScore;

  return Number(Math.max(0, Math.min(1, score)).toFixed(3));
}

function hasValidityOverlap(offer, validity) {
  if (!validity.validFrom || !validity.validTo) {
    return true;
  }

  const from = offer.validFrom ? new Date(offer.validFrom) : null;
  const to = offer.validTo ? new Date(offer.validTo) : null;

  return (!from || from <= validity.validTo) && (!to || to >= validity.validFrom);
}

function summarizeOffer(offer, score) {
  return {
    id: String(offer._id),
    score,
    title: offer.title || '',
    brand: offer.brand || '',
    price: offer.priceCurrent?.amount ?? null,
    quantityText: offer.quantityText || '',
    validFrom: dateKey(offer.validFrom),
    validTo: dateKey(offer.validTo),
    sourceType: offer.sourceType || '',
    sourceUrl: offer.sourceUrl || '',
    conditionsText: offer.conditionsText || '',
    customerProgramRequired: Boolean(offer.customerProgramRequired),
  };
}

function compareCandidatesToOffers(candidates, offers, validity) {
  const matched = [];
  const missingLikely = [];
  const uncertain = [];
  const excluded = [];

  for (const candidate of candidates) {
    if (candidate.exclusionReason) {
      excluded.push(candidate);
      continue;
    }

    const bestMatches = offers
      .map((offer) => ({
        offer,
        score: scoreMatch(candidate, offer, validity),
      }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 5);
    const best = bestMatches[0];
    const item = {
      candidate,
      bestMatches: bestMatches.map((match) => summarizeOffer(match.offer, match.score)),
    };

    if (best?.score >= 0.72) {
      matched.push(item);
    } else if (best?.score >= 0.45) {
      uncertain.push(item);
    } else {
      missingLikely.push(item);
    }
  }

  return {
    matched,
    missingLikely,
    uncertain,
    excluded,
  };
}

function summarizeCandidate(candidate) {
  return {
    id: candidate.id,
    page: candidate.page,
    title: candidate.title,
    price: candidate.price,
    quantityText: candidate.quantityText,
    conditionsText: candidate.conditionsText,
    rawText: candidate.rawText,
    exclusionReason: candidate.exclusionReason || '',
  };
}

function detectParserIssues(candidates) {
  return candidates
    .filter((candidate) =>
      /[0-9][,.][0-9]{2}\S/.test(candidate.rawText)
      || /N u r k u r z e Z e i t/i.test(candidate.rawText)
      || tokenList(candidate.title).length < 2
      || (candidate.price === null && !candidate.conditionsText)
    )
    .slice(0, 25)
    .map(summarizeCandidate);
}

function buildCauseAnalysis(context) {
  const sourceFacts = context.sources.map((source) => ({
    channel: source.channel,
    label: source.label,
    sourceUrl: source.sourceUrl,
    sourceType: source.sourceType,
    enabled: source.enabled !== false,
    active: source.active !== false,
    latestStatus: source.latestStatus || '',
    latestRunAt: source.latestRunAt ? new Date(source.latestRunAt).toISOString() : null,
    capabilities: source.capabilities || {},
    notes: source.notes || '',
  }));
  const officialFlyer = sourceFacts.find((source) => source.channel === 'official-flyer');
  const officialSite = sourceFacts.find((source) => source.channel === 'official-site');
  const aktionsfinder = sourceFacts.find((source) => source.sourceUrl.includes('aktionsfinder.at'));
  const officialPdfOfferCount = context.offers.filter((offer) => offer.sourceType === 'penny-official-pdf').length;
  const hasOfficialPdfParserEvidence = officialPdfOfferCount > 0
    || context.rawDocuments.some((doc) => doc.sourceType === 'penny-official-pdf' && Number(doc.parsedOffers || 0) > 0);

  return {
    likelyCauses: [
      hasOfficialPdfParserEvidence
        ? `PENNY official-flyer PDF parser is active; ${officialPdfOfferCount} matching DB offers in this audit window come from penny-official-pdf. Remaining misses are mostly PDF text/layout ambiguity, weak title-price grouping, or intentionally excluded non-offer app/campaign text.`
        : officialFlyer
        ? 'PENNY official-flyer source exists, but current officialSourceCrawler has no PENNY PDF-to-offer parser branch; it stores/discovers HTML/PDF links but does not normalize PDF leaflet items into Offer documents.'
        : 'No PENNY official-flyer source found in Source collection.',
      officialSite
        ? 'PENNY official-site parser reads product tiles from penny.at/angebote; this can miss leaflet-only placements, coupons, multi-buy blocks, non-food pages, and layout-only PDF offers.'
        : 'No PENNY official-site source found in Source collection.',
      aktionsfinder
        ? 'Aktionsfinder source is configured as aggregator; coverage depends on which offers Aktionsfinder exposes and on category-page limits.'
        : 'No Aktionsfinder PENNY source found in Source collection.',
      'Existing normalizers usually drop candidates without a title and current price; PDF-only coupons or mechanics without a clean price are therefore likely absent from Offer storage.',
      'Current PENNY official HTML parser does not explicitly model Gutschein/jö/App/multi-buy mechanics from flyer text; conditions may be empty even when the flyer has restrictions.',
    ],
    sourceFacts,
    recentRawDocuments: context.rawDocuments.map((doc) => ({
      documentType: doc.documentType,
      sourceType: doc.sourceType,
      title: doc.title,
      url: doc.url,
      fetchedAt: doc.fetchedAt ? new Date(doc.fetchedAt).toISOString() : null,
      foundRawItems: doc.foundRawItems ?? null,
      parsedOffers: doc.parsedOffers ?? null,
      rejectedOffers: doc.rejectedOffers ?? null,
      parserVersion: doc.parserVersion || '',
      payload: doc.payload || {},
    })),
    recentCrawlJobs: context.crawlJobs.map((job) => ({
      status: job.status,
      trigger: job.trigger,
      startedAt: job.startedAt ? new Date(job.startedAt).toISOString() : null,
      sourceType: job.sourceType,
      sourceUrl: job.sourceUrl,
      parserVersion: job.parserVersion || '',
      stats: job.stats || {},
      warnings: job.warningMessages || [],
      errors: job.errorMessages || [],
      metadata: {
        extractedLinkCount: job.metadata?.extractedLinkCount ?? null,
        evidenceMatched: job.metadata?.evidenceMatched ?? null,
        essence: job.metadata?.essence || '',
      },
    })),
  };
}

function buildExcludedReasonBreakdown(excluded) {
  return excluded.reduce((acc, candidate) => {
    const reason = candidate.exclusionReason || 'unknown';
    acc[reason] = (acc[reason] || 0) + 1;
    return acc;
  }, {});
}

function buildReport({ pdfReference, context, comparison, options }) {
  const totalPdfCandidates = pdfReference.candidates.length;
  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'read-only',
    retailerKey: 'penny',
    retailerName: 'PENNY',
    checkedPdfPath: pdfReference.file.path,
    pdf: {
      bytes: pdfReference.file.bytes,
      pages: pdfReference.file.pages,
      textLength: pdfReference.textLength,
      detectedValidity: {
        validFrom: dateKey(pdfReference.validity.validFrom),
        validTo: dateKey(pdfReference.validity.validTo),
        detectedDates: pdfReference.validity.detectedDates,
      },
      pageCandidateCounts: pdfReference.pages,
    },
    db: {
      totalDbPennyOffers: context.offers.length,
      query: context.offerQuery,
      sourceBreakdown: context.offers.reduce((acc, offer) => {
        const key = offer.sourceType || 'unknown';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
    },
    summary: {
      totalPdfCandidates,
      totalDbPennyOffers: context.offers.length,
      matchedCount: comparison.matched.length,
      missingLikelyCount: comparison.missingLikely.length,
      uncertainCount: comparison.uncertain.length,
      excludedCount: comparison.excluded.length,
      excludedReasons: buildExcludedReasonBreakdown(comparison.excluded),
      parserIssueExampleCount: detectParserIssues(pdfReference.candidates).length,
    },
    examples: {
      missingLikely: comparison.missingLikely.slice(0, options.examples).map((item) => ({
        candidate: summarizeCandidate(item.candidate),
        bestMatches: item.bestMatches,
      })),
      uncertain: comparison.uncertain.slice(0, options.examples).map((item) => ({
        candidate: summarizeCandidate(item.candidate),
        bestMatches: item.bestMatches,
      })),
      matched: comparison.matched.slice(0, Math.min(5, options.examples)).map((item) => ({
        candidate: summarizeCandidate(item.candidate),
        bestMatches: item.bestMatches.slice(0, 2),
      })),
      excluded: comparison.excluded.slice(0, Math.min(10, options.examples)).map(summarizeCandidate),
      potentialParserErrors: detectParserIssues(pdfReference.candidates),
    },
    causeAnalysis: buildCauseAnalysis(context),
    conservativeNextSteps: [
      'Use this report to manually inspect missingLikely and uncertain examples before changing crawler behavior.',
      'Minimal code improvement candidate: add a dedicated PENNY PDF leaflet ingestion path that stores PDF candidates as conditional/non-comparison-safe offers when price or unit parsing is uncertain.',
      'Keep multi-buy, Gutschein, jö/App, Pfand, short validity, and availability hints in conditionsText/rawFacts even when comparisonSafe=false.',
      'Do not drop Non-Food; classify as Non-Food/Sonstiges when no better category is available.',
    ],
  };

  return report;
}

function printMarkdown(report) {
  console.log(`# PENNY Leaflet Coverage Audit`);
  console.log('');
  console.log(`Generated: ${report.generatedAt}`);
  console.log(`PDF: \`${report.checkedPdfPath}\``);
  console.log(`Validity: ${report.pdf.detectedValidity.validFrom || '?'} to ${report.pdf.detectedValidity.validTo || '?'}`);
  console.log('');
  console.log('## Summary');
  console.log(`- totalPdfCandidates: ${report.summary.totalPdfCandidates}`);
  console.log(`- totalDbPennyOffers: ${report.summary.totalDbPennyOffers}`);
  console.log(`- matchedCount: ${report.summary.matchedCount}`);
  console.log(`- missingLikelyCount: ${report.summary.missingLikelyCount}`);
  console.log(`- uncertainCount: ${report.summary.uncertainCount}`);
  console.log(`- excludedCount: ${report.summary.excludedCount}`);
  console.log('');
  console.log('## Missing Likely Examples');
  for (const item of report.examples.missingLikely) {
    console.log(`- p.${item.candidate.page} ${item.candidate.title} price=${item.candidate.price ?? '?'} qty="${item.candidate.quantityText}"`);
  }
  console.log('');
  console.log('## Uncertain Match Examples');
  for (const item of report.examples.uncertain) {
    const best = item.bestMatches[0];
    console.log(`- p.${item.candidate.page} ${item.candidate.title} -> ${best ? `${best.title} (${best.score})` : 'no candidate'}`);
  }
  console.log('');
  console.log('## Likely Causes');
  for (const cause of report.causeAnalysis.likelyCauses) {
    console.log(`- ${cause}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  await fs.access(options.pdfPath);
  const pdfReference = await extractPdfReference(options.pdfPath);

  await connectToDatabase();
  const context = await loadDbContext(pdfReference.validity);
  const comparison = compareCandidatesToOffers(pdfReference.candidates, context.offers, pdfReference.validity);
  const report = buildReport({
    pdfReference,
    context,
    comparison,
    options,
  });

  if (options.format === 'markdown') {
    printMarkdown(report);
  } else {
    const output = JSON.stringify(report, null, 2);

    if (options.output) {
      await fs.writeFile(options.output, `${output}\n`, 'utf8');
    } else {
      console.log(output);
    }
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
