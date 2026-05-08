const { sanitizeWhitespace, normalizeTitleForMatch } = require('./sourceEvidence');
const {
  parsePdfPriceAmount,
  hasPlausibleProductTitle,
  isBadPdfLine,
} = require('./pdfOfferParsing');

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizePolygonPoint(point) {
  if (Array.isArray(point)) {
    return {
      x: toFiniteNumber(point[0]),
      y: toFiniteNumber(point[1]),
    };
  }

  return {
    x: toFiniteNumber(point?.x),
    y: toFiniteNumber(point?.y),
  };
}

function bboxFromPolygon(polygon = []) {
  const points = polygon.map(normalizePolygonPoint);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  if (![minX, maxX, minY, maxY].every(Number.isFinite)) {
    return null;
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

function normalizeOcrBox(input = {}, defaults = {}) {
  const rawPolygon = input.polygon || input.points || input.poly || input.box;
  const polygon = Array.isArray(rawPolygon) ? rawPolygon.map(normalizePolygonPoint) : [];
  const sourceBbox = input.bbox || input.boundingBox || input.rect || {};
  const derivedBbox = polygon.length > 0 ? bboxFromPolygon(polygon) : null;
  const bbox = derivedBbox || {
    x: toFiniteNumber(sourceBbox.x ?? sourceBbox.left),
    y: toFiniteNumber(sourceBbox.y ?? sourceBbox.top),
    width: toFiniteNumber(sourceBbox.width ?? (sourceBbox.right - sourceBbox.left)),
    height: toFiniteNumber(sourceBbox.height ?? (sourceBbox.bottom - sourceBbox.top)),
  };

  return {
    text: sanitizeWhitespace(input.text ?? input.value ?? input.label ?? ''),
    confidence: input.confidence === undefined ? null : toFiniteNumber(input.confidence, null),
    bbox,
    polygon,
    pageNumber: toFiniteNumber(input.pageNumber ?? input.page ?? defaults.pageNumber, defaults.pageNumber || 1),
  };
}

function normalizeOcrBoxes(items = [], defaults = {}) {
  return items
    .map((item) => normalizeOcrBox(item, defaults))
    .filter((item) => item.text && item.bbox.width >= 0 && item.bbox.height >= 0);
}

function getBoxCenter(box = {}) {
  return {
    x: toFiniteNumber(box.x) + toFiniteNumber(box.width) / 2,
    y: toFiniteNumber(box.y) + toFiniteNumber(box.height) / 2,
  };
}

function getBoxDistance(left = {}, right = {}) {
  const leftCenter = getBoxCenter(left);
  const rightCenter = getBoxCenter(right);
  const dx = rightCenter.x - leftCenter.x;
  const dy = rightCenter.y - leftCenter.y;

  return Math.sqrt((dx * dx) + (dy * dy));
}

function mergeBboxes(boxes = []) {
  const validBoxes = boxes.filter((box) => box && Number.isFinite(Number(box.x)) && Number.isFinite(Number(box.y)));

  if (!validBoxes.length) {
    return null;
  }

  const minX = Math.min(...validBoxes.map((box) => toFiniteNumber(box.x)));
  const minY = Math.min(...validBoxes.map((box) => toFiniteNumber(box.y)));
  const maxX = Math.max(...validBoxes.map((box) => toFiniteNumber(box.x) + toFiniteNumber(box.width)));
  const maxY = Math.max(...validBoxes.map((box) => toFiniteNumber(box.y) + toFiniteNumber(box.height)));

  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

function looksLikeNonOfferPriceText(text) {
  const normalized = normalizeTitleForMatch(text);

  return /\b(?:kg|g|l|ml|cl|stk|stueck|stuck|wg|kapsel|kapseln)\s*=?\s*\d{1,3}[,.]\d{2}\b/i.test(text)
    || /\b\d+(?:[,.]\d+)?\s*(?:kg|g|l|ml|cl|stk|stueck|stuck|wg)\s*=/i.test(text)
    || /\b(?:gespart|pfand|einwegpfand|gueltig|gultig)\b/i.test(normalized);
}

function looksLikeDateText(text) {
  const value = sanitizeWhitespace(text);

  return /(?:^|\D)\d{1,2}\.\d{1,2}\.(?:\d{2,4})?(?=$|\D)/.test(value);
}

function isUnitOnlyText(text) {
  const normalized = normalizeTitleForMatch(text);

  return /^(?:je\s+)?(?:pkg|packung|stk|stueck|stuck|kg|g|l|ml|cl|fl|rolle|wg)$/.test(normalized)
    || /^\d+(?:[,.]\d+)?\s*(?:pkg|packung|stk|stueck|stuck|kg|g|l|ml|cl|fl|rolle|wg)$/.test(normalized)
    || /^(?:kg|g|l|ml|cl|stk|stueck|stuck|pkg|packung)\s*=?\s*\d{1,3}[,.]\d{2}$/.test(normalized);
}

function isConditionOnlyText(text) {
  const normalized = normalizeTitleForMatch(text);

  return /gutschein/.test(normalized)
    || /\b30\s+tage\s+preise\b/.test(normalized)
    || /\b(?:gueltig|gultig|von|bis|mo|di|do)\b/.test(normalized);
}

function isNoiseOnlyText(text) {
  const normalized = normalizeTitleForMatch(text);

  return looksLikeDateText(text)
    || /\b(?:osterreich|usterreich|canal)\b/.test(normalized);
}

function classifyOcrTextCandidate(box = {}) {
  const text = box.text || '';

  if (!text) {
    return { candidateKind: 'noise', candidateReasons: ['empty-text'] };
  }

  if (isUnitOnlyText(text)) {
    return { candidateKind: 'unit', candidateReasons: ['unit-only-text'] };
  }

  if (isConditionOnlyText(text)) {
    return { candidateKind: 'condition', candidateReasons: ['condition-only-text'] };
  }

  if (isNoiseOnlyText(text) || isBadPdfLine(text)) {
    return { candidateKind: 'noise', candidateReasons: ['noise-text'] };
  }

  if (parsePdfPriceAmount(text) !== null) {
    return { candidateKind: 'noise', candidateReasons: ['price-like-text'] };
  }

  if (hasPlausibleProductTitle(text)) {
    return { candidateKind: 'title', candidateReasons: ['plausible-product-title'] };
  }

  return { candidateKind: 'noise', candidateReasons: ['implausible-product-title'] };
}

function findPriceBoxes(ocrBoxes = []) {
  return ocrBoxes
    .map((box) => {
      const amount = parsePdfPriceAmount(box.text);

      if (amount === null || looksLikeDateText(box.text) || looksLikeNonOfferPriceText(box.text)) {
        return null;
      }

      return {
        ...box,
        amount,
      };
    })
    .filter(Boolean);
}

function isLikelyTitleBox(box = {}) {
  return classifyOcrTextCandidate(box).candidateKind === 'title';
}

function isSameOcrBox(left = {}, right = {}) {
  return left.pageNumber === right.pageNumber
    && left.text === right.text
    && toFiniteNumber(left.bbox?.x) === toFiniteNumber(right.bbox?.x)
    && toFiniteNumber(left.bbox?.y) === toFiniteNumber(right.bbox?.y)
    && toFiniteNumber(left.bbox?.width) === toFiniteNumber(right.bbox?.width)
    && toFiniteNumber(left.bbox?.height) === toFiniteNumber(right.bbox?.height);
}

function groupNearbyOcrText(priceBox = {}, ocrBoxes = [], options = {}) {
  const maxDistance = toFiniteNumber(options.maxDistance, 220);
  const maxItems = toFiniteNumber(options.maxItems, 8);
  const samePageBoxes = ocrBoxes.filter((box) => box.pageNumber === priceBox.pageNumber && !isSameOcrBox(box, priceBox));
  const nearby = samePageBoxes
    .map((box) => ({
      ...box,
      distance: Number(getBoxDistance(priceBox.bbox, box.bbox).toFixed(2)),
      direction: getBoxCenter(box.bbox).y < getBoxCenter(priceBox.bbox).y ? 'before' : 'after',
      ...classifyOcrTextCandidate(box),
    }))
    .map((box) => ({
      ...box,
      titleLike: box.candidateKind === 'title',
    }))
    .filter((box) => box.distance <= maxDistance)
    .sort((left, right) => left.distance - right.distance)
    .slice(0, maxItems);

  return nearby;
}

function buildOcrOfferBlockCandidates(ocrBoxes = [], options = {}) {
  const priceBoxes = findPriceBoxes(ocrBoxes);

  return priceBoxes.map((priceBox) => {
    const nearbyTextByDistance = groupNearbyOcrText(priceBox, ocrBoxes, options);
    const titleCandidates = nearbyTextByDistance.filter((box) => box.titleLike);
    const unitCandidates = nearbyTextByDistance.filter((box) => box.candidateKind === 'unit');
    const conditionCandidates = nearbyTextByDistance.filter((box) => box.candidateKind === 'condition');
    const noiseCandidates = nearbyTextByDistance.filter((box) => box.candidateKind === 'noise');
    const nearestTitle = titleCandidates[0] || null;
    const rejectionHints = [];
    const confidenceHints = [];

    if (!nearestTitle) {
      rejectionHints.push('no-usable-product-title');

      if (conditionCandidates.length > 0) {
        rejectionHints.push('condition-text-instead-of-title');
      }

      if (unitCandidates.length > 0) {
        rejectionHints.push('unit-text-instead-of-title');
      }

      if (noiseCandidates.length > 0) {
        rejectionHints.push('noise-text-instead-of-title');
      }
    }

    if (titleCandidates.length > 2) {
      rejectionHints.push('multiple-nearby-title-boxes');
    }

    if (nearestTitle) {
      confidenceHints.push('nearest-title-box');
    }

    if (priceBox.amount > 0) {
      confidenceHints.push('plausible-price-box');
    }

    const likelyExtractable = priceBox.amount > 0
      && !looksLikeDateText(priceBox.text)
      && Boolean(nearestTitle)
      && classifyOcrTextCandidate(nearestTitle || {}).candidateKind === 'title'
      && rejectionHints.length === 0;

    return {
      pageNumber: priceBox.pageNumber,
      price: priceBox.amount,
      priceText: priceBox.text,
      priceBox: priceBox.bbox,
      priceConfidence: priceBox.confidence,
      nearestTitleText: nearestTitle?.text || '',
      nearestTitleBox: nearestTitle?.bbox || null,
      nearestTitleConfidence: nearestTitle?.confidence ?? null,
      nearestTitleDistance: nearestTitle?.distance ?? null,
      nearbyTextByDistance,
      titleCandidates,
      unitCandidates,
      conditionCandidates,
      noiseCandidates,
      candidateText: sanitizeWhitespace([nearestTitle?.text || '', priceBox.text].join(' ')).slice(0, 280),
      confidenceHints,
      rejectionHints,
      needsManualReview: !likelyExtractable,
      likelyExtractable,
    };
  });
}

function findPossibleQuantityOrUnitText(texts = []) {
  return texts.find((text) => /\b\d+(?:[,.]\d+)?\s*(?:kg|g|l|ml|cl|stk|stueck|stuck|stück|wg|rolle|fl|kapsel|kapseln|packung|pkg)\b/i.test(text)
    || /\b(?:kg|g|l|ml|cl|stk|stueck|stuck|stück|wg|rolle|fl|kapsel|kapseln)\s*=?\s*\d{1,3}[,.]\d{2}\b/i.test(text)) || '';
}

function buildQualityFlags(candidate = {}) {
  candidate = candidate || {};
  const nearby = candidate.nearbyTextByDistance || [];
  const nearbyTexts = nearby.map((item) => item.text).filter(Boolean);
  const normalizedContext = normalizeTitleForMatch([candidate.nearestTitleText, ...nearbyTexts].join(' '));
  const lowConfidenceValues = [
    candidate.priceConfidence,
    candidate.nearestTitleConfidence,
    ...nearby.map((item) => item.confidence),
  ].filter((value) => value !== null && value !== undefined);

  return {
    hasPrice: Boolean(candidate.priceText && candidate.price !== null && candidate.price !== undefined),
    hasNearbyText: Boolean(candidate.nearestTitleText || nearbyTexts.length),
    lowConfidence: lowConfidenceValues.some((value) => Number(value) < 0.5),
    suspiciousShortText: Boolean(candidate.nearestTitleText && normalizeTitleForMatch(candidate.nearestTitleText).length <= 3),
    possibleConditionOnly: /\b(?:gutschein|gueltig|gultig|gültig|gespart|rabatt|pickerl|app|j[oö]|\bnur\b|bei\s+\d+|ab\s+\d+)\b/i.test(normalizedContext),
    possibleMultiBuy: /\b(?:\d+\s*\+\s*\d+|gratis|2\s*fuer\s*1|2\s*für\s*1|4\s*fuer\s*2|4\s*für\s*2|bei\s+\d+\s*stk|ab\s+\d+\s*stk)\b/i.test(normalizedContext),
    possibleLoyaltyCondition: /\b(?:app|j[oö]|joker|kundenkarte|konto|mitglied|gutschein)\b/i.test(normalizedContext),
  };
}

function buildConfidenceSummary(candidate = {}) {
  candidate = candidate || {};
  const nearby = candidate.nearbyTextByDistance || [];
  const nearbyConfidenceValues = nearby
    .map((item) => item.confidence)
    .filter((value) => value !== null && value !== undefined)
    .map(Number)
    .filter(Number.isFinite);

  return {
    hints: candidate.confidenceHints || [],
    rejectionHints: candidate.rejectionHints || [],
    priceConfidence: candidate.priceConfidence ?? null,
    nearestTitleConfidence: candidate.nearestTitleConfidence ?? null,
    minNearbyConfidence: nearbyConfidenceValues.length ? Math.min(...nearbyConfidenceValues) : null,
    nearestTitleDistance: candidate.nearestTitleDistance ?? null,
  };
}

function buildCandidateBlockPreview(candidate = {}, index = 0) {
  candidate = candidate || {};
  const nearby = candidate.nearbyTextByDistance || [];
  const contextLines = nearby.slice(0, 8).map((item) => ({
    text: item.text,
    distancePx: item.distance ?? null,
    direction: item.direction || '',
    confidence: item.confidence ?? null,
    titleLike: Boolean(item.titleLike),
    candidateKind: item.candidateKind || '',
    candidateReasons: item.candidateReasons || [],
  }));
  const nearbyTexts = contextLines.map((item) => item.text).filter(Boolean);
  const textBoxes = [
    candidate.nearestTitleBox,
    ...nearby.slice(0, 4).map((item) => item.bbox),
  ].filter(Boolean);
  const mapCandidatePreview = (items = []) => items.slice(0, 8).map((item) => ({
    text: item.text,
    distancePx: item.distance ?? null,
    direction: item.direction || '',
    confidence: item.confidence ?? null,
    reasons: item.candidateReasons || [],
  }));

  return {
    blockIndex: index + 1,
    pageNumber: candidate.pageNumber ?? null,
    priceText: candidate.priceText || '',
    parsedPrice: candidate.price ?? null,
    priceValue: candidate.price ?? null,
    productText: candidate.nearestTitleText || '',
    likelyExtractable: Boolean(candidate.likelyExtractable),
    needsManualReview: candidate.needsManualReview !== undefined
      ? Boolean(candidate.needsManualReview)
      : (candidate.rejectionHints || []).length > 0,
    nearbyText: nearbyTexts.join(' | '),
    contextLines,
    titleCandidates: mapCandidatePreview(candidate.titleCandidates || nearby.filter((item) => item.candidateKind === 'title')),
    unitCandidates: mapCandidatePreview(candidate.unitCandidates || nearby.filter((item) => item.candidateKind === 'unit')),
    conditionCandidates: mapCandidatePreview(candidate.conditionCandidates || nearby.filter((item) => item.candidateKind === 'condition')),
    noiseCandidates: mapCandidatePreview(candidate.noiseCandidates || nearby.filter((item) => item.candidateKind === 'noise')),
    possibleQuantityOrUnitText: findPossibleQuantityOrUnitText(nearbyTexts),
    confidenceSummary: buildConfidenceSummary(candidate),
    priceBox: candidate.priceBox || null,
    textBox: candidate.nearestTitleBox || null,
    mergedTextBox: mergeBboxes([candidate.priceBox, ...textBoxes]),
    distancePx: candidate.nearestTitleDistance ?? null,
    distanceScore: candidate.nearestTitleDistance === null || candidate.nearestTitleDistance === undefined
      ? null
      : Number((1 / (1 + Number(candidate.nearestTitleDistance))).toFixed(4)),
    qualityFlags: buildQualityFlags(candidate),
    rawLineCount: 1 + nearby.length,
  };
}

function buildCandidateBlockPreviews(candidateBlocks = [], options = {}) {
  const limit = Math.max(0, Number(options.limit || 20));

  return candidateBlocks.slice(0, limit).map((candidate, index) => buildCandidateBlockPreview(candidate, index));
}

function summarizeOcrDiagnostics(ocrBoxes = [], options = {}) {
  const detectedPriceBoxes = findPriceBoxes(ocrBoxes);
  const candidateBlocks = buildOcrOfferBlockCandidates(ocrBoxes, options);
  const cleanCandidateBlocks = candidateBlocks.filter((candidate) => candidate.rejectionHints.length === 0);
  const problemBlocks = candidateBlocks.filter((candidate) => candidate.rejectionHints.length > 0);
  const previewLimit = Math.max(1, Number(options.previewLimit || 20));

  return {
    bbox: {
      available: ocrBoxes.length > 0,
      mode: ocrBoxes.length > 0 ? 'ocr-bbox' : 'unavailable',
    },
    detectedPriceBoxes,
    nearbyTextByDistance: candidateBlocks.slice(0, 20).map((candidate) => ({
      pageNumber: candidate.pageNumber,
      priceText: candidate.priceText,
      price: candidate.price,
      nearbyTextByDistance: candidate.nearbyTextByDistance,
    })),
    candidateBlocks,
    cleanCandidateBlocks,
    problemBlocks,
    candidateBlocksPreview: buildCandidateBlockPreviews(candidateBlocks, { limit: previewLimit }),
    cleanCandidateBlocksPreview: buildCandidateBlockPreviews(cleanCandidateBlocks, { limit: previewLimit }),
    problemBlocksPreview: buildCandidateBlockPreviews(problemBlocks, { limit: previewLimit }),
  };
}

function getLayoutPriceCandidates(layoutDiagnostics = {}) {
  return (layoutDiagnostics.pages || []).flatMap((page) => (page.priceCandidates || []).map((candidate) => ({
    ...candidate,
    pageNumber: page.pageNumber,
  })));
}

function buildPriceCandidateComparison({
  layoutDiagnostics = {},
  ocrDiagnostics = {},
  maxExamples = 12,
} = {}) {
  const textFlowPriceCandidates = getLayoutPriceCandidates(layoutDiagnostics);
  const ocrPriceBoxes = ocrDiagnostics.detectedPriceBoxes || [];
  const ocrBlocks = ocrDiagnostics.candidateBlocks || [];
  const cleanOcrBlocks = ocrBlocks.filter((candidate) => candidate.rejectionHints.length === 0);
  const problemOcrBlocks = ocrBlocks.filter((candidate) => candidate.rejectionHints.length > 0);
  const pages = [...new Set([
    ...textFlowPriceCandidates.map((candidate) => candidate.pageNumber),
    ...ocrPriceBoxes.map((candidate) => candidate.pageNumber),
  ])].sort((left, right) => left - right);

  const pageComparisons = pages.map((pageNumber) => {
    const textFlowPagePrices = textFlowPriceCandidates.filter((candidate) => candidate.pageNumber === pageNumber);
    const ocrPagePrices = ocrPriceBoxes.filter((candidate) => candidate.pageNumber === pageNumber);
    const matchedByAmount = ocrPagePrices.filter((ocrPrice) => textFlowPagePrices.some((textFlowPrice) => textFlowPrice.amount === ocrPrice.amount));

    return {
      pageNumber,
      textFlowPriceCandidates: textFlowPagePrices.length,
      ocrPriceBoxes: ocrPagePrices.length,
      matchedByAmount: matchedByAmount.length,
      ocrOnlyPriceExamples: ocrPagePrices
        .filter((ocrPrice) => !textFlowPagePrices.some((textFlowPrice) => textFlowPrice.amount === ocrPrice.amount))
        .slice(0, 5)
        .map((ocrPrice) => ({
          text: ocrPrice.text,
          amount: ocrPrice.amount,
          bbox: ocrPrice.bbox,
        })),
    };
  });

  return {
    totals: {
      textFlowPriceCandidates: textFlowPriceCandidates.length,
      ocrPriceBoxes: ocrPriceBoxes.length,
      matchedByPageAndAmount: pageComparisons.reduce((sum, page) => sum + page.matchedByAmount, 0),
      candidateBlocks: ocrBlocks.length,
      cleanCandidateBlocks: cleanOcrBlocks.length,
      problemBlocks: problemOcrBlocks.length,
    },
    pages: pageComparisons,
    cleanCandidateExamples: cleanOcrBlocks.slice(0, maxExamples).map((candidate) => ({
      pageNumber: candidate.pageNumber,
      price: candidate.price,
      priceText: candidate.priceText,
      nearestTitleText: candidate.nearestTitleText,
      nearestTitleDistance: candidate.nearestTitleDistance,
    })),
    problemExamples: problemOcrBlocks.slice(0, maxExamples).map((candidate) => ({
      pageNumber: candidate.pageNumber,
      price: candidate.price,
      priceText: candidate.priceText,
      nearestTitleText: candidate.nearestTitleText,
      nearestTitleDistance: candidate.nearestTitleDistance,
      rejectionHints: candidate.rejectionHints,
    })),
  };
}

module.exports = {
  normalizeOcrBox,
  normalizeOcrBoxes,
  findPriceBoxes,
  groupNearbyOcrText,
  buildOcrOfferBlockCandidates,
  buildCandidateBlockPreview,
  buildCandidateBlockPreviews,
  buildQualityFlags,
  summarizeOcrDiagnostics,
  buildPriceCandidateComparison,
};
