const { PDFParse } = require('pdf-parse');
const {
  sanitizeWhitespace,
  normalizeTitleForMatch,
} = require('../crawl/sourceEvidence');
const {
  parsePdfPriceAmount,
  hasPlausibleProductTitle,
  isBadPdfLine,
} = require('../crawl/pdfOfferParsing');
const {
  determineCategoryDecision,
} = require('../crawl/categoryClassifier');
const {
  DEFAULT_CANDIDATE_SOURCES,
  fetchCandidateSource,
  evaluateCandidateSource,
  findEvidenceHits,
} = require('./sparFlyerSourceDiagnostic');

const SOURCE_TYPE = 'spar-ipaper-pdf-textlayer';
const DEFAULT_MAX_CANDIDATES_PER_PDF = 80;
const DEFAULT_CONTEXT_RADIUS = 5;
const VALIDITY_EVIDENCE_TYPES = Object.freeze({
  OFFER_TEXT: 'explicit-offer-text',
  PAGE_TEXT: 'explicit-page-text',
  FLYER_CONTEXT: 'explicit-flyer-context',
  SOURCE_CONTEXT_ONLY: 'source-context-only',
  MISSING: 'missing',
});

const COFFEE_EVIDENCE_TERMS = [
  'REGIO Gold',
  'Tassimo',
  'Nescafe',
  'Nescafé',
  'Cafe Royal',
  'Café Royal',
  'Meinl',
  'Präsident',
  'Praesident',
  'Dallmayr',
  'Prodomo',
  'Kaffee',
  'Kapseln',
  'Löskaffee',
  'Loeskaffee',
];

const READ_ONLY_CONTRACT = Object.freeze({
  readOnly: true,
  mutatedCollections: Object.freeze([]),
  forbiddenImports: Object.freeze([
    'src/config/mongodb',
    'src/models/',
  ]),
});

function normalizeForPrototype(value) {
  return normalizeTitleForMatch(value)
    .replace(/\bnescafa c\b/g, 'nescafe')
    .replace(/\bprasa sident\b/g, 'prasident')
    .replace(/\bla s skaffee\b/g, 'loskaffee')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitPdfTextLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => sanitizeWhitespace(line.replace(/\u00a0/g, ' ')))
    .filter(Boolean);
}

function countOfferPrices(lines = []) {
  return lines.filter((line) => parseOfferPriceCandidate(line) !== null).length;
}

function isValidityLine(line) {
  const normalized = normalizeForPrototype(line);
  return /\b(gueltig|gultig|gültig|von|bis|do|mo|di|mi|fr|sa|so)\b/i.test(line)
    && /\b\d{1,2}\.\d{1,2}\.(?:20\d{2})?\b/.test(line)
    && !/\b\d{1,4}\.-(?!\d)/.test(line);
}

function isUnitPriceOrFootnoteLine(line) {
  const normalized = normalizeForPrototype(line);

  return isValidityLine(line)
    || /\b\d+(?:[,.]\d+)?\s*(?:kg|g|l|ml|cl|stk|stueck|stuck|stück|wg|kapsel|kapseln|fl)\s*=/i.test(line)
    || /\b(?:kg|g|l|ml|cl|stk|stueck|stuck|stück|wg|kapsel|kapseln|fl)\s*\/?\s*\d{1,3}[,.]\d{2}\b/i.test(line)
    || /\b(statt|gespart|vergleich|pfand|einwegpfand|solange der vorrat reicht)\b/i.test(normalized);
}

function parseOfferPriceCandidate(line) {
  if (isUnitPriceOrFootnoteLine(line)) {
    return null;
  }

  return parsePdfPriceAmount(line);
}

function isConditionLine(line) {
  const normalized = normalizeForPrototype(line);

  return /\b(\d+\s*\+\s*\d+|gratis|ab\s+\d+\s*(?:stk|stueck|stuck|stück|packungen|pkg)|bei\s+\d+\b|nur mit|spar app|app|kundenkarte|karte|jö|joe|rabattmarke|prozentpickerl|mindestkauf|-?\d{1,2}\s*%|alle kaffees)\b/i.test(normalized);
}

function isQuantityLine(line) {
  return /\b(\d+(?:[,.]\d+)?\s*(?:kg|g|l|ml|cl|stk|stueck|stuck|stück|kapseln|kapsel|packung|pkg|fl|flasche|flaschen)|\d+\s*x\s*\d+(?:[,.]\d+)?\s*(?:g|kg|ml|l|cl|stk))\b/i.test(line);
}

function isProductLine(line) {
  if (!line || parseOfferPriceCandidate(line) !== null || isConditionLine(line) || isValidityLine(line) || isQuantityLineV2(line)) {
    return false;
  }

  const normalized = normalizeForPrototype(line);

  if (!/[a-z]/.test(normalized)) {
    return false;
  }

  if (/^(aktion|angebot|preis|statt|gratis|gueltig|gultig|seite|nur|ab|bei|je|pro|flugblatt|spar|interspar)\b/.test(normalized)) {
    return false;
  }

  return hasPlausibleProductTitle(line) && !isBadPdfLine(line);
}

function extractQuantityAndUnit(text) {
  const normalized = sanitizeWhitespace(text);
  const patterns = [
    /\b(\d+\s*x\s*\d+(?:[,.]\d+)?)\s*(kg|g|l|ml|cl|stk|stueck|stuck|stück|kapseln|kapsel)\b/i,
    /\b(\d+(?:[,.]\d+)?)\s*(kg|g|l|ml|cl|stk|stueck|stuck|stück|kapseln|kapsel|packung|pkg|fl|flasche|flaschen)\b/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);

    if (match) {
      return {
        quantityCandidate: sanitizeWhitespace(match[0]),
        unitCandidate: match[2],
      };
    }
  }

  return {
    quantityCandidate: '',
    unitCandidate: '',
  };
}

function extractQuantityAndUnitV2(text) {
  const normalized = sanitizeWhitespace(text);
  const patterns = [
    /\b(\d+\s*x\s*\d+(?:[,.]\d+)?)\s*(kg|g|l|liter|ml|cl|stk|stueck|stuck|stÃ¼ck|kapseln|kapsel)\b/i,
    /\b(\d+(?:[,.]\d+)?)\s*(kg|g|l|liter|ml|cl|stk|stueck|stuck|stÃ¼ck|kapseln|kapsel|packung|pkg|tafel|tafeln|fl|flasche|flaschen)\b/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);

    if (match) {
      return {
        quantityCandidate: sanitizeWhitespace(match[0]),
        unitCandidate: match[2],
      };
    }
  }

  return {
    quantityCandidate: '',
    unitCandidate: '',
  };
}

function isQuantityLineV2(line) {
  return Boolean(extractQuantityAndUnitV2(line).quantityCandidate);
}

function extractValidityCandidate(text) {
  const source = String(text || '');
  const flexibleExplicitRange = source.match(/\b(?:gueltig|gultig|g\S{0,3}ltig)\s+(?:von\s+)?(\d{1,2}\.\d{1,2}\.(?:20\d{2})?)\s+(?:bis|-)\s+(?:\w+\s+)?(\d{1,2}\.\d{1,2}\.(?:20\d{2})?)\b/i);

  if (flexibleExplicitRange) {
    return sanitizeWhitespace(flexibleExplicitRange[0]);
  }

  const explicitRange = source.match(/\b(?:gueltig|gultig|gültig)\s+(?:von\s+)?(\d{1,2}\.\d{1,2}\.(?:20\d{2})?)\s+(?:bis|-)\s+(?:\w+\s+)?(\d{1,2}\.\d{1,2}\.(?:20\d{2})?)\b/i);

  if (explicitRange) {
    return sanitizeWhitespace(explicitRange[0]);
  }

  const range = source.match(/\b(?:von\s+)?(\d{1,2}\.\d{1,2}\.(?:20\d{2})?)\s+(?:bis|-)\s+(?:\w+\s+)?(\d{1,2}\.\d{1,2}\.(?:20\d{2})?)\b/i);

  if (range && /\b(gueltig|gultig|gültig|aktion|angebote|flugblatt)\b/i.test(source.slice(Math.max(0, range.index - 80), range.index + range[0].length + 80))) {
    return sanitizeWhitespace(range[0]);
  }

  return '';
}

function classifyValidityEvidence(matchText, evidenceType) {
  if (!matchText) {
    return {
      validityCandidate: '',
      validityEvidenceType: VALIDITY_EVIDENCE_TYPES.MISSING,
      validityConfidence: 'none',
      validitySafeForImport: false,
    };
  }

  if (evidenceType === VALIDITY_EVIDENCE_TYPES.SOURCE_CONTEXT_ONLY) {
    return {
      validityCandidate: matchText,
      validityEvidenceType: evidenceType,
      validityConfidence: 'low',
      validitySafeForImport: false,
    };
  }

  return {
    validityCandidate: matchText,
    validityEvidenceType: evidenceType,
    validityConfidence: evidenceType === VALIDITY_EVIDENCE_TYPES.OFFER_TEXT ? 'high' : 'medium',
    validitySafeForImport: true,
  };
}

function extractValidityEvidence(text, evidenceType = VALIDITY_EVIDENCE_TYPES.OFFER_TEXT) {
  return classifyValidityEvidence(extractValidityCandidate(text), evidenceType);
}

function extractSourceContextValidityCandidate(source = {}) {
  const sourceText = [
    source.key,
    source.title,
    source.url,
    source.finalUrl,
  ].filter(Boolean).join('\n');
  const urlRange = sourceText.match(/-(\d{2})-(\d{2})-(20\d{2})-(\d{2})-(\d{2})-(20\d{2})\/?(\b|$)/);

  if (urlRange) {
    return classifyValidityEvidence(
      `${urlRange[1]}.${urlRange[2]}.${urlRange[3]} bis ${urlRange[4]}.${urlRange[5]}.${urlRange[6]}`,
      VALIDITY_EVIDENCE_TYPES.SOURCE_CONTEXT_ONLY
    );
  }

  return classifyValidityEvidence(extractValidityCandidate(sourceText), VALIDITY_EVIDENCE_TYPES.SOURCE_CONTEXT_ONLY);
}

function pickBestValidityEvidence({ blockText = '', pageText = '', flyerText = '', source = {} } = {}) {
  const sourceContext = extractSourceContextValidityCandidate(source);
  const offerEvidence = extractValidityEvidence(blockText, VALIDITY_EVIDENCE_TYPES.OFFER_TEXT);

  if (offerEvidence.validityCandidate) {
    return {
      ...offerEvidence,
      sourceContextValidityCandidate: sourceContext.validityCandidate,
    };
  }

  const pageEvidence = extractValidityEvidence(pageText, VALIDITY_EVIDENCE_TYPES.PAGE_TEXT);

  if (pageEvidence.validityCandidate) {
    return {
      ...pageEvidence,
      sourceContextValidityCandidate: sourceContext.validityCandidate,
    };
  }

  const flyerEvidence = extractValidityEvidence(flyerText, VALIDITY_EVIDENCE_TYPES.FLYER_CONTEXT);

  if (flyerEvidence.validityCandidate) {
    return {
      ...flyerEvidence,
      sourceContextValidityCandidate: sourceContext.validityCandidate,
    };
  }

  return {
    ...sourceContext,
    sourceContextValidityCandidate: sourceContext.validityCandidate,
  };
}

function extractConditionCandidate(text) {
  const lines = splitPdfTextLines(text);
  const conditions = lines
    .filter(isConditionLine)
    .map((line) => sanitizeWhitespace(line))
    .filter(Boolean);

  return [...new Set(conditions)].join(' / ').slice(0, 220);
}

function detectMixedOfferBlock(lines = []) {
  const priceLineCount = countOfferPrices(lines);
  const productLineCount = lines.filter(isProductLine).length;

  return priceLineCount > 1 || productLineCount > 2;
}

function shouldStopBackwardAtLine(line, collectedBefore = []) {
  if (parseOfferPriceCandidate(line) !== null) {
    return true;
  }

  if (isValidityLine(line)) {
    return collectedBefore.length > 0;
  }

  const hasCollectedProduct = collectedBefore.some(isProductLine);
  const hasCollectedQuantity = collectedBefore.some(isQuantityLineV2);
  const collectedProductCount = collectedBefore.filter(isProductLine).length;

  if (isProductLine(line) && hasCollectedProduct && (hasCollectedQuantity || collectedProductCount >= 2)) {
    return true;
  }

  if (isConditionLine(line) && hasCollectedProduct && hasCollectedQuantity) {
    return true;
  }

  return false;
}

function normalizeBlockLines(lines = []) {
  const compact = [];

  for (const line of lines) {
    const text = sanitizeWhitespace(line);

    if (text && compact[compact.length - 1] !== text) {
      compact.push(text);
    }
  }

  return compact;
}

function splitPdfTextIntoBlocks(text, { radius = DEFAULT_CONTEXT_RADIUS } = {}) {
  const lines = splitPdfTextLines(text);
  const blocks = [];

  for (let index = 0; index < lines.length; index += 1) {
    const price = parseOfferPriceCandidate(lines[index]);

    if (price === null) {
      continue;
    }

    const before = [];
    for (let cursor = index - 1; cursor >= 0 && before.length < radius; cursor -= 1) {
      if (shouldStopBackwardAtLine(lines[cursor], before)) {
        break;
      }

      before.unshift(lines[cursor]);
    }

    const after = [];
    for (let cursor = index + 1; cursor < lines.length && after.length < 3; cursor += 1) {
      if (parseOfferPriceCandidate(lines[cursor]) !== null) {
        break;
      }

      if (isProductLine(lines[cursor])) {
        break;
      }

      after.push(lines[cursor]);
    }

    const blockLines = normalizeBlockLines([...before, lines[index], ...after]);
    blocks.push({
      lineIndex: index,
      price,
      lines: blockLines,
      text: blockLines.join('\n'),
      mixedOfferBlock: detectMixedOfferBlock(blockLines),
    });
  }

  return blocks;
}

function pickTitleCandidate(blockLines = []) {
  const priceIndex = blockLines.findIndex((line) => parseOfferPriceCandidate(line) !== null);
  const before = priceIndex >= 0 ? blockLines.slice(0, priceIndex) : blockLines;
  const productLines = before
    .filter(isProductLine)
    .filter((line) => !isQuantityLineV2(line))
    .slice(-2);

  if (productLines.length === 0) {
    return '';
  }

  return sanitizeWhitespace(productLines.join(' ')).replace(/\*/g, '').slice(0, 140);
}

function buildCategoryProjection(titleCandidate, surroundingText) {
  const decision = determineCategoryDecision({
    title: titleCandidate,
    contextText: surroundingText,
    sourceCategory: '',
  });

  return {
    primaryCategory: decision.primaryCategory,
    secondaryCategory: decision.secondaryCategory,
    confidence: decision.categoryConfidence,
    needsReview: decision.needsReview,
  };
}

function evaluateFiveQuestions(candidate) {
  return {
    what: Boolean(candidate.titleCandidate),
    where: Boolean(candidate.retailerKey && candidate.sourceUrl),
    when: Boolean(candidate.validitySafeForImport),
    quantityUnit: Boolean(candidate.quantityCandidate && candidate.unitCandidate),
    condition: Boolean(candidate.conditionCandidate),
  };
}

function statusFromCandidate({
  titleCandidate,
  priceCandidate,
  quantityCandidate,
  unitCandidate,
  conditionCandidate,
  validitySafeForImport,
  mixedOfferBlock,
}) {
  const missingFields = [];
  const rejectionReasons = [];

  if (!titleCandidate) {
    missingFields.push('titleCandidate');
    rejectionReasons.push('missing-clear-title');
  }

  if (!(Number(priceCandidate) > 0)) {
    missingFields.push('priceCandidate');
    rejectionReasons.push('missing-clear-price');
  }

  if (!quantityCandidate || !unitCandidate) {
    missingFields.push('quantityCandidate');
  }

  if (!validitySafeForImport) {
    missingFields.push('validityCandidate');
  }

  if (!conditionCandidate) {
    missingFields.push('conditionCandidate');
  }

  if (mixedOfferBlock) {
    rejectionReasons.push('mixed-offer-block');
  }

  if (rejectionReasons.includes('missing-clear-title') || rejectionReasons.includes('missing-clear-price') || mixedOfferBlock) {
    return {
      candidateStatus: 'reject',
      missingFields,
      rejectionReason: rejectionReasons.join(', '),
    };
  }

  if (missingFields.length > 0) {
    return {
      candidateStatus: 'needs_review',
      missingFields,
      rejectionReason: '',
    };
  }

  return {
    candidateStatus: 'ready',
    missingFields,
    rejectionReason: '',
  };
}

function buildOfferCandidateFromBlock({
  block,
  source,
  pageNumber,
  pageText = '',
  validityContext = '',
} = {}) {
  const surroundingText = sanitizeWhitespace(block.text).slice(0, 700);
  const titleCandidate = pickTitleCandidate(block.lines);
  const priceCandidate = block.price;
  const quantity = extractQuantityAndUnitV2(block.text);
  const validity = pickBestValidityEvidence({
    blockText: block.text,
    pageText,
    flyerText: validityContext,
    source,
  });
  const conditionCandidate = extractConditionCandidate(block.text);
  const categoryProjection = buildCategoryProjection(titleCandidate, surroundingText);
  const status = statusFromCandidate({
    titleCandidate,
    priceCandidate,
    quantityCandidate: quantity.quantityCandidate,
    unitCandidate: quantity.unitCandidate,
    conditionCandidate,
    validitySafeForImport: validity.validitySafeForImport,
    mixedOfferBlock: block.mixedOfferBlock,
  });
  const baseConfidence = 0.25
    + (titleCandidate ? 0.2 : 0)
    + (priceCandidate ? 0.2 : 0)
    + (quantity.quantityCandidate ? 0.13 : 0)
    + (validity.validitySafeForImport ? 0.12 : 0)
    + (conditionCandidate ? 0.08 : 0)
    + (!block.mixedOfferBlock ? 0.1 : -0.15);
  const candidate = {
    retailerKey: 'spar',
    sourceRetailerFormat: source.key.includes('interspar') ? 'INTERSPAR' : 'SPAR',
    sourceKey: source.key,
    sourceType: SOURCE_TYPE,
    sourceUrl: source.finalUrl || source.url,
    pageNumber,
    titleCandidate,
    priceCandidate,
    quantityCandidate: quantity.quantityCandidate,
    unitCandidate: quantity.unitCandidate,
    validityCandidate: validity.validityCandidate,
    validityEvidenceType: validity.validityEvidenceType,
    validityConfidence: validity.validityConfidence,
    validitySafeForImport: validity.validitySafeForImport,
    sourceContextValidityCandidate: validity.sourceContextValidityCandidate || '',
    conditionCandidate,
    surroundingText,
    categoryProjection,
    confidence: Math.max(0, Math.min(0.95, Number(baseConfidence.toFixed(2)))),
    candidateStatus: status.candidateStatus,
    missingFields: status.missingFields,
    answersFiveQuestions: {},
  };

  candidate.answersFiveQuestions = evaluateFiveQuestions(candidate);

  if (status.rejectionReason) {
    candidate.rejectionReason = status.rejectionReason;
  }

  return candidate;
}

async function extractTextPagesFromPdfBuffer(buffer) {
  const parser = new PDFParse({ data: buffer });

  try {
    const fullText = await parser.getText();
    const pages = [];

    for (let page = 1; page <= fullText.total; page += 1) {
      const result = await parser.getText({ partial: [page] });
      pages.push({
        pageNumber: page,
        text: result.text || '',
        charCount: String(result.text || '').length,
      });
    }

    return {
      pageCount: fullText.total,
      textLength: String(fullText.text || '').length,
      fullText: fullText.text || '',
      pages,
    };
  } finally {
    await parser.destroy();
  }
}

function summarizeRejectionReasons(candidates = []) {
  const counts = new Map();

  for (const candidate of candidates) {
    const reason = candidate.rejectionReason || '';

    if (!reason) {
      continue;
    }

    counts.set(reason, (counts.get(reason) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([reason, count]) => ({ reason, count }));
}

function buildCoffeeEvidence(candidates = [], sourceEvaluations = []) {
  const evidenceCandidates = candidates.filter((candidate) =>
    findEvidenceHits(candidate.surroundingText, COFFEE_EVIDENCE_TERMS).length > 0
  );
  const terms = new Map();

  for (const candidate of evidenceCandidates) {
    for (const hit of findEvidenceHits(candidate.surroundingText, COFFEE_EVIDENCE_TERMS)) {
      terms.set(hit.normalized, {
        term: hit.term,
        normalized: hit.normalized,
        count: (terms.get(hit.normalized)?.count || 0) + hit.count,
      });
    }
  }

  for (const source of sourceEvaluations) {
    for (const hit of source.evidenceHits || []) {
      if (!COFFEE_EVIDENCE_TERMS.some((term) => normalizeForPrototype(term) === hit.normalized)) {
        continue;
      }

      terms.set(hit.normalized, {
        term: hit.term,
        normalized: hit.normalized,
        count: (terms.get(hit.normalized)?.count || 0) + hit.count,
      });
    }
  }

  return {
    candidateCount: evidenceCandidates.length,
    terms: [...terms.values()].sort((left, right) => left.normalized.localeCompare(right.normalized)),
    candidates: evidenceCandidates.slice(0, 20),
    focusProducts: buildCoffeeFocusProducts(candidates),
  };
}

function summarizeMainBlocker(candidate) {
  if (!candidate) {
    return 'no-candidate-detected';
  }

  if (candidate.candidateStatus === 'ready') {
    return '';
  }

  if (candidate.rejectionReason) {
    return candidate.rejectionReason;
  }

  if (candidate.missingFields?.length) {
    return `missing-${candidate.missingFields.join('-')}`;
  }

  return 'needs-review';
}

function buildCoffeeFocusProducts(candidates = []) {
  const products = [
    { key: 'regioGold', label: 'REGIO Gold', terms: ['REGIO Gold'] },
    { key: 'tassimo', label: 'Tassimo', terms: ['Tassimo'] },
    { key: 'nescafe', label: 'Nescafe', terms: ['Nescafe', 'NescafÃ©'] },
    { key: 'cafeRoyal', label: 'Cafe Royal', terms: ['Cafe Royal', 'CafÃ© Royal'] },
    { key: 'meinlPraesident', label: 'Meinl/Praesident', terms: ['Meinl', 'PrÃ¤sident', 'Praesident'] },
    { key: 'dallmayrProdomo', label: 'Dallmayr/Prodomo', terms: ['Dallmayr', 'Prodomo'] },
  ];

  return products.map((product) => {
    const matches = candidates.filter((candidate) =>
      product.terms.some((term) => findEvidenceHits(candidate.surroundingText, [term]).length > 0)
    );
    const candidate = matches.find((item) => item.candidateStatus !== 'reject') || matches[0] || null;

    return {
      key: product.key,
      label: product.label,
      candidateDetected: Boolean(candidate),
      titleClear: Boolean(candidate?.titleCandidate),
      priceClear: Number(candidate?.priceCandidate) > 0,
      quantityClear: Boolean(candidate?.quantityCandidate && candidate?.unitCandidate),
      validityClear: Boolean(candidate?.validitySafeForImport),
      conditionClear: Boolean(candidate?.conditionCandidate),
      status: candidate?.candidateStatus || 'missing',
      mainBlocker: summarizeMainBlocker(candidate),
      sourceKey: candidate?.sourceKey || '',
      pageNumber: candidate?.pageNumber || null,
      titleCandidate: candidate?.titleCandidate || '',
    };
  });
}

function buildRecommendations(summary) {
  if (summary.readyCandidates > 0 && summary.textLayerAvailable > 0) {
    return [
      'Evidence-only result: SPAR/iPaper PDF text layers can produce structured candidates, but this is not a productive data-quality improvement.',
      'A small next dev step is possible: run a controlled read-only comparison against current DB/API gaps, then decide whether a capped dev-only ingestion experiment is safe.',
    ];
  }

  if (summary.needsReviewCandidates > 0) {
    return [
      'Keep this as parser evidence for now: candidates exist, but missing validity, quantity, title, or layout confidence prevents productive ingestion.',
      'Improve block grouping or add explicit PDF validity extraction before any dev-only pipeline step.',
    ];
  }

  return [
    'No productive step is recommended from this run; keep SPAR official PDF parsing as read-only evidence until structured candidates improve.',
  ];
}

function buildSummary({ sourcesChecked, pdfReports, candidates }) {
  const rejectionReasonCount = (reason) => candidates.filter((candidate) =>
    String(candidate.rejectionReason || '').split(/,\s*/).includes(reason)
  ).length;

  return {
    pdfsChecked: sourcesChecked.filter((source) => source.expectedMode === 'pdf').length,
    pdfsAccessible: pdfReports.filter((pdf) => pdf.accessible).length,
    textLayerAvailable: pdfReports.filter((pdf) => pdf.textLayerAvailable).length,
    totalCandidateBlocks: candidates.length,
    readyCandidates: candidates.filter((candidate) => candidate.candidateStatus === 'ready').length,
    needsReviewCandidates: candidates.filter((candidate) => candidate.candidateStatus === 'needs_review').length,
    rejectedCandidates: candidates.filter((candidate) => candidate.candidateStatus === 'reject').length,
    mixedOfferBlockCount: rejectionReasonCount('mixed-offer-block'),
    missingClearTitleCount: rejectionReasonCount('missing-clear-title'),
    missingQuantityUnitCount: candidates.filter((candidate) => candidate.missingFields.includes('quantityCandidate')).length,
    missingValidityCount: candidates.filter((candidate) => candidate.missingFields.includes('validityCandidate')).length,
    safeValidityCount: candidates.filter((candidate) => candidate.validitySafeForImport).length,
    coffeeEvidenceCandidates: candidates.filter((candidate) => findEvidenceHits(candidate.surroundingText, COFFEE_EVIDENCE_TERMS).length > 0).length,
    rejectionReasons: summarizeRejectionReasons(candidates),
  };
}

function buildReadinessAssessment(summary) {
  const blockers = [];

  if (summary.readyCandidates === 0) {
    blockers.push('no-ready-candidates');
  }

  if (summary.safeValidityCount === 0) {
    blockers.push('no-import-safe-validity');
  }

  if (summary.mixedOfferBlockCount > 0) {
    blockers.push('remaining-mixed-offer-blocks');
  }

  if (summary.missingQuantityUnitCount > 0) {
    blockers.push('remaining-missing-quantity-unit');
  }

  return {
    canProceedToDevPipelinePrototype: summary.readyCandidates > 0
      && summary.safeValidityCount > 0
      && summary.mixedOfferBlockCount === 0,
    blockers,
    smallestNextStep: summary.safeValidityCount === 0
      ? 'Find an official PDF/flyer text signal with explicit date range before any dev-pipeline prototype.'
      : 'Use ready candidates only in a capped read-only dev comparison before considering any ingestion experiment.',
  };
}

async function buildSparPdfOfferPrototypeReport({
  candidates = DEFAULT_CANDIDATE_SOURCES,
  now = new Date(),
  fetchSource = fetchCandidateSource,
  extractPages = extractTextPagesFromPdfBuffer,
  maxCandidatesPerPdf = DEFAULT_MAX_CANDIDATES_PER_PDF,
  previousComparableMetrics = null,
} = {}) {
  const checkedAt = now instanceof Date ? now.toISOString() : now;
  const pdfCandidates = candidates.filter((candidate) => candidate.expectedMode === 'pdf');
  const sourceEvaluations = [];
  const pdfReports = [];
  const offerCandidates = [];

  for (const sourceCandidate of pdfCandidates) {
    const fetched = await fetchSource(sourceCandidate);
    const evaluated = await evaluateCandidateSource({
      candidate: sourceCandidate,
      fetched,
      extractPdfText: async (buffer) => {
        const extracted = await extractPages(buffer);
        return extracted.fullText || extracted.pages.map((page) => page.text).join('\n');
      },
    });
    sourceEvaluations.push(evaluated);

    const pdfReport = {
      key: sourceCandidate.key,
      url: sourceCandidate.url,
      finalUrl: evaluated.finalUrl || sourceCandidate.url,
      accessible: evaluated.accessible && evaluated.extractionMode === 'pdf-text',
      status: evaluated.status,
      contentType: evaluated.contentType,
      size: evaluated.size,
      textLayerAvailable: false,
      pageCount: 0,
      textLength: 0,
      candidateBlocks: 0,
      reasonIfRejected: evaluated.reasonIfRejected || '',
    };

    if (!pdfReport.accessible || !fetched.buffer) {
      pdfReports.push(pdfReport);
      continue;
    }

    try {
      const extracted = await extractPages(fetched.buffer);
      pdfReport.textLayerAvailable = extracted.textLength > 0 || extracted.pages.some((page) => page.charCount > 0);
      pdfReport.pageCount = extracted.pageCount;
      pdfReport.textLength = extracted.textLength;

      const validityContext = extractValidityCandidate(extracted.fullText);

      for (const page of extracted.pages) {
        const blocks = splitPdfTextIntoBlocks(page.text);
        pdfReport.candidateBlocks += blocks.length;

        for (const block of blocks) {
          if (offerCandidates.filter((candidate) => candidate.sourceKey === sourceCandidate.key).length >= maxCandidatesPerPdf) {
            break;
          }

          offerCandidates.push(buildOfferCandidateFromBlock({
            block,
            pageNumber: page.pageNumber,
            source: {
              ...sourceCandidate,
              finalUrl: evaluated.finalUrl,
            },
            pageText: page.text,
            validityContext,
          }));
        }
      }
    } catch (error) {
      pdfReport.reasonIfRejected = `pdf-page-text-extraction-failed: ${error.message}`;
    }

    pdfReports.push(pdfReport);
  }

  const summary = buildSummary({
    sourcesChecked: pdfCandidates,
    pdfReports,
    candidates: offerCandidates,
  });

  return {
    ok: true,
    checkedAt,
    readOnly: true,
    mutatedCollections: [],
    sourcesChecked: pdfCandidates.map((candidate) => ({
      key: candidate.key,
      url: candidate.url,
      expectedMode: candidate.expectedMode,
    })),
    pdfs: pdfReports,
    summary,
    previousComparableMetrics,
    readinessAssessment: buildReadinessAssessment(summary),
    candidates: offerCandidates,
    coffeeEvidence: buildCoffeeEvidence(offerCandidates, sourceEvaluations),
    recommendations: buildRecommendations(summary),
    caveat: 'Read-only prototype only: no productive offers, no RawDocuments, no cache writes, no DB mutation, no OCR, and no claim of productive data-quality improvement.',
  };
}

module.exports = {
  SOURCE_TYPE,
  COFFEE_EVIDENCE_TERMS,
  READ_ONLY_CONTRACT,
  normalizeForPrototype,
  splitPdfTextLines,
  splitPdfTextIntoBlocks,
  parseOfferPriceCandidate,
  extractQuantityAndUnit: extractQuantityAndUnitV2,
  extractQuantityAndUnitV2,
  extractValidityCandidate,
  extractValidityEvidence,
  extractSourceContextValidityCandidate,
  extractConditionCandidate,
  buildOfferCandidateFromBlock,
  buildCoffeeEvidence,
  buildSummary,
  buildRecommendations,
  extractTextPagesFromPdfBuffer,
  buildSparPdfOfferPrototypeReport,
};
