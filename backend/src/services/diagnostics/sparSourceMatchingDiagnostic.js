const fs = require('node:fs');
const path = require('node:path');
const { normalizeTitleForMatch } = require('../crawl/sourceEvidence');
const { sourceKeyForFormat } = require('../crawl/sparOfficialFlyerPdfParser');

const TARGET_RETAILERS = ['spar', 'interspar', 'eurospar'];
const PDF_SOURCE_TYPE = 'spar-official-pdf';
const AGGREGATOR_SOURCE_TYPE = 'aktionsfinder-json';
const PDF_SOURCE_KEYS = new Set([
  'spar-official-flyer-pdf',
  'interspar-official-flyer-pdf',
  'eurospar-official-flyer-pdf',
]);
const AGGREGATOR_SOURCE_KEYS = new Set([
  'aktionsfinder-spar',
  'aktionsfinder-interspar',
  'aktionsfinder-eurospar',
]);
const FORMAT_BY_AGGREGATOR_SOURCE_KEY = {
  'aktionsfinder-spar': 'spar',
  'aktionsfinder-interspar': 'interspar',
  'aktionsfinder-eurospar': 'eurospar',
};
const FORMAT_BY_PDF_SOURCE_KEY = {
  'spar-official-flyer-pdf': 'spar',
  'interspar-official-flyer-pdf': 'interspar',
  'eurospar-official-flyer-pdf': 'eurospar',
};

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
  'div',
  'diverse',
  'eine',
  'einer',
  'extra',
  'gratis',
  'je',
  'karton',
  'kartons',
  'kg',
  'kiste',
  'kisten',
  'l',
  'liter',
  'mit',
  'nur',
  'oder',
  'pack',
  'packung',
  'packungen',
  'pkg',
  'pro',
  'sorten',
  'statt',
  'stueck',
  'stk',
  'stuck',
  'und',
  'versch',
  'verschiedene',
  'von',
  'zum',
  'dose',
  'dosen',
  'flasche',
  'flaschen',
]);

function uniq(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function normalizeKey(value) {
  return normalizeTitleForMatch(value).replace(/\s+/g, '-');
}

function normalizeText(value) {
  return normalizeTitleForMatch(value);
}

function sourceKeyForOffer(offer = {}) {
  return offer.sourceKey
    || offer.rawFacts?.sourceKey
    || offer.rawFacts?.sourceMetadata?.sourceKey
    || '';
}

function sourceTypeForOffer(offer = {}) {
  return offer.sourceType || offer.rawFacts?.sourceType || '';
}

function retailerFormatForOffer(offer = {}) {
  const sourceKey = sourceKeyForOffer(offer);
  const rawFormat = offer.sourceRetailerFormat
    || offer.rawFacts?.sourceRetailerFormat
    || offer.rawFacts?.sourceMetadata?.sourceRetailerFormat
    || FORMAT_BY_PDF_SOURCE_KEY[sourceKey]
    || FORMAT_BY_AGGREGATOR_SOURCE_KEY[sourceKey]
    || offer.retailerKey
    || '';

  const normalized = normalizeKey(rawFormat);
  if (normalized === 'billa-plus') return 'billa-plus';
  return TARGET_RETAILERS.includes(normalized) ? normalized : '';
}

function isPdfOffer(offer = {}) {
  return PDF_SOURCE_KEYS.has(sourceKeyForOffer(offer)) || sourceTypeForOffer(offer) === PDF_SOURCE_TYPE;
}

function isAggregatorOffer(offer = {}) {
  return AGGREGATOR_SOURCE_KEYS.has(sourceKeyForOffer(offer)) || sourceTypeForOffer(offer) === AGGREGATOR_SOURCE_TYPE;
}

function offerText(offer = {}) {
  return [
    offer.brand,
    offer.titleNormalized,
    offer.title,
    offer.quantityText,
    offer.conditionsText,
  ].join(' ');
}

function offerTokens(offer = {}) {
  return normalizeText(`${offer.brand || ''} ${offer.titleNormalized || offer.title || ''}`)
    .split(/\s+/)
    .filter((token) => token.length >= 3)
    .filter((token) => !STOP_WORDS.has(token))
    .filter((token) => !/^\d+$/.test(token));
}

function jaccard(leftTokens = [], rightTokens = []) {
  const left = new Set(leftTokens);
  const right = new Set(rightTokens);
  if (left.size === 0 || right.size === 0) return 0;
  const intersection = [...left].filter((token) => right.has(token)).length;
  return intersection / new Set([...left, ...right]).size;
}

function cents(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) : null;
}

function dateKey(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function dateValue(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function hasValidity(offer = {}) {
  return Boolean(dateKey(offer.validFrom) || dateKey(offer.validTo));
}

function validityCompatible(left = {}, right = {}) {
  if (!hasValidity(left) || !hasValidity(right)) return true;

  const leftFrom = dateValue(left.validFrom);
  const leftTo = dateValue(left.validTo);
  const rightFrom = dateValue(right.validFrom);
  const rightTo = dateValue(right.validTo);

  if (leftFrom && leftTo && rightFrom && rightTo) {
    return leftFrom <= rightTo && rightFrom <= leftTo;
  }

  return dateKey(left.validFrom) === dateKey(right.validFrom)
    || dateKey(left.validTo) === dateKey(right.validTo);
}

function priceState(left = {}, right = {}) {
  const leftCents = cents(left.priceCurrent?.amount);
  const rightCents = cents(right.priceCurrent?.amount);
  if (leftCents === null || rightCents === null) return 'missing';
  if (Math.abs(leftCents - rightCents) <= 1) return 'same';
  if (Math.abs(leftCents - rightCents) <= 25 || Math.abs(leftCents - rightCents) / Math.max(leftCents, rightCents) <= 0.08) {
    return 'close';
  }
  return 'conflict';
}

function quantitySignature(offer = {}) {
  return [
    Number.isFinite(Number(offer.packCount)) ? String(Number(offer.packCount)) : '',
    Number.isFinite(Number(offer.unitValue)) ? Number(offer.unitValue).toFixed(3) : '',
    normalizeKey(offer.unitType || ''),
    Number.isFinite(Number(offer.totalComparableAmount)) ? Number(offer.totalComparableAmount).toFixed(3) : '',
    normalizeKey(offer.comparableUnit || offer.normalizedUnitPrice?.unit || ''),
  ].join('|');
}

function quantityTextSignature(offer = {}) {
  const text = normalizeText(`${offer.quantityText || ''} ${offer.title || ''}`);
  return uniq([...text.matchAll(/\b(\d+(?:[,.]\d+)?)\s*(kg|g|l|ml|cl|stk|stueck|stuck|dose|dosen|flasche|flaschen|kiste|kisten|tabs|kapseln)\b/g)]
    .map((match) => `${Number(String(match[1]).replace(',', '.'))}:${match[2] === 'stuck' ? 'stueck' : match[2]}`))
    .sort()
    .join('|');
}

function normalizeQuantityText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\u00c3\u0178/g, 'ss')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u00d7]/g, 'x')
    .replace(/[^a-z0-9.,+*x]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function diagnosticQuantityText(offer = {}) {
  return normalizeQuantityText([
    offer.title,
    offer.titleNormalized,
    offer.brand,
    offer.quantityText,
    offer.conditionsText,
    offer.rawFacts?.validityText,
    offer.rawFacts?.infoText,
    offer.rawFacts?.minimumPurchaseQuantity,
    offer.rawFacts?.requiredQuantity,
  ].join(' '));
}

function parseDiagnosticNumber(value) {
  const number = Number(String(value || '').replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

function canonicalMeasure(unit) {
  const normalized = normalizeQuantityText(unit);
  if (normalized === 'l' || normalized === 'liter') return { baseUnit: 'l', factor: 1 };
  if (normalized === 'ml') return { baseUnit: 'l', factor: 0.001 };
  if (normalized === 'cl') return { baseUnit: 'l', factor: 0.01 };
  if (normalized === 'kg') return { baseUnit: 'kg', factor: 1 };
  if (normalized === 'g') return { baseUnit: 'kg', factor: 0.001 };
  return { baseUnit: '', factor: 1 };
}

function canonicalContainer(value = '') {
  const normalized = normalizeQuantityText(value);
  if (['dose', 'dosen'].includes(normalized)) return 'dose';
  if (['flasche', 'flaschen'].includes(normalized)) return 'flasche';
  if (['kiste', 'kisten'].includes(normalized)) return 'kiste';
  if (['packung', 'packungen', 'pkg', 'pack', 'packs', 'paket', 'pakete'].includes(normalized)) return 'packung';
  if (['stueck', 'stuck', 'stk'].includes(normalized)) return 'stueck';
  if (['karton', 'kartons'].includes(normalized)) return 'karton';
  return normalized;
}

function nearlyEqual(left, right, tolerance = 0.001) {
  if (!Number.isFinite(Number(left)) || !Number.isFinite(Number(right))) return false;
  return Math.abs(Number(left) - Number(right)) <= tolerance;
}

function addMeasure(result, value, unit) {
  const number = parseDiagnosticNumber(value);
  const measure = canonicalMeasure(unit);
  if (number === null || !measure.baseUnit) return;

  const canonicalValue = Number((number * measure.factor).toFixed(4));
  if (!result.unitSize) {
    result.baseUnit = measure.baseUnit;
    result.unitSize = canonicalValue;
  }
}

function addPackCount(result, value, confidence = 0.82) {
  const number = parseDiagnosticNumber(value);
  if (number === null || number <= 0) return;

  const count = Math.round(number);
  if (!result.packCount || count > result.packCount) {
    result.packCount = count;
  }
  result.quantityConfidence = Math.max(result.quantityConfidence, confidence);
}

function firstRegexMatch(text, regex) {
  const matches = [...text.matchAll(regex)];
  return matches.length > 0 ? matches[0] : null;
}

function detectBundleMechanic(text = '') {
  const mechanics = [];
  const plusGratis = firstRegexMatch(text, /\b(\d+)\s*\+\s*(\d+)\s*gratis\b/g);
  const forOne = firstRegexMatch(text, /\b(\d+)\s*(?:fuer|fur)\s*(\d+)\b/g);

  if (plusGratis) mechanics.push(`${plusGratis[1]}+${plusGratis[2]}-gratis`);
  if (forOne) mechanics.push(`${forOne[1]}-for-${forOne[2]}`);
  if (/\bab\s+\d+\b|\bbei\s+\d+\b|\bmindestkauf\b/.test(text)) mechanics.push('threshold');
  if (/%|pickerl|rabattmarke|joker/.test(text)) mechanics.push('percent-or-sticker');

  return uniq(mechanics).join('|');
}

function normalizeDiagnosticQuantity(offer = {}) {
  const text = diagnosticQuantityText(offer);
  const result = {
    baseUnit: '',
    unitSize: null,
    packCount: null,
    containerType: '',
    totalQuantity: null,
    quantityConfidence: 0,
    conditionPackCount: null,
    bundleMechanic: detectBundleMechanic(text),
    normalizedQuantityKey: '',
    unsafeQuantityReasons: [],
  };

  if (!text) {
    result.unsafeQuantityReasons.push('quantity-missing');
    return result;
  }

  const structuredPackCount = Number(offer.packCount);
  const structuredUnitValue = Number(offer.unitValue);
  const structuredTotal = Number(offer.totalComparableAmount);
  const structuredUnit = canonicalMeasure(offer.unitType || offer.comparableUnit || offer.normalizedUnitPrice?.unit || '');

  if (Number.isFinite(structuredPackCount) && structuredPackCount > 0) {
    result.packCount = Math.round(structuredPackCount);
    result.quantityConfidence = Math.max(result.quantityConfidence, 0.95);
  }
  if (Number.isFinite(structuredUnitValue) && structuredUnitValue > 0 && structuredUnit.baseUnit) {
    result.baseUnit = structuredUnit.baseUnit;
    result.unitSize = Number((structuredUnitValue * structuredUnit.factor).toFixed(4));
    result.quantityConfidence = Math.max(result.quantityConfidence, 0.9);
  }
  if (Number.isFinite(structuredTotal) && structuredTotal > 0 && (offer.comparableUnit || offer.normalizedUnitPrice?.unit)) {
    const totalUnit = canonicalMeasure(offer.comparableUnit || offer.normalizedUnitPrice?.unit || '');
    if (totalUnit.baseUnit) {
      result.baseUnit = result.baseUnit || totalUnit.baseUnit;
      result.totalQuantity = Number((structuredTotal * totalUnit.factor).toFixed(4));
      result.quantityConfidence = Math.max(result.quantityConfidence, 0.9);
    }
  }

  const containerPattern = '(stueck|stuck|stk|dose|dosen|flasche|flaschen|kiste|kisten|packung|packungen|pkg|pack|karton|kartons)';
  const measurePattern = '(kg|g|l|liter|ml|cl)';
  const numberPattern = '(\\d+(?:[,.]\\d+)?)';
  const explicitContainer = firstRegexMatch(text, new RegExp(`\\b${containerPattern}\\b`, 'g'));
  const crateContainer = firstRegexMatch(text, /\b(?:kiste|kisten)\b/g);

  if (crateContainer) {
    result.containerType = 'kiste';
  } else if (explicitContainer) {
    result.containerType = canonicalContainer(explicitContainer[1] || explicitContainer[0]);
  }

  const conditionCount = firstRegexMatch(text, new RegExp(`\\b(?:ab|bei)\\s+(\\d+)\\s*${containerPattern}\\b`, 'g'));
  if (conditionCount) {
    result.conditionPackCount = Number(conditionCount[1]);
  }

  const directMultipack = firstRegexMatch(text, new RegExp(`\\b${numberPattern}\\s*(?:x|\\*)\\s*${numberPattern}\\s*${measurePattern}\\b`, 'g'));
  const containerThenMeasure = firstRegexMatch(text, new RegExp(`\\b${numberPattern}\\s*${containerPattern}\\s*(?:a|je|zu|mit)?\\s*${numberPattern}\\s*${measurePattern}\\b`, 'g'));
  const measureThenContainer = firstRegexMatch(text, new RegExp(`\\b${numberPattern}\\s*${measurePattern}\\s*(?:\\/)?\\s*${numberPattern}\\s*${containerPattern}\\b`, 'g'));

  if (directMultipack) {
    addPackCount(result, directMultipack[1], 0.96);
    addMeasure(result, directMultipack[2], directMultipack[3]);
  } else if (containerThenMeasure) {
    addPackCount(result, containerThenMeasure[1], 0.94);
    result.containerType = result.containerType || canonicalContainer(containerThenMeasure[2]);
    addMeasure(result, containerThenMeasure[3], containerThenMeasure[4]);
  } else if (measureThenContainer) {
    addMeasure(result, measureThenContainer[1], measureThenContainer[2]);
    addPackCount(result, measureThenContainer[3], 0.94);
    result.containerType = result.containerType || canonicalContainer(measureThenContainer[4]);
  }

  const packOnly = firstRegexMatch(text, new RegExp(`\\b(\\d+)\\s*${containerPattern}\\b`, 'g'));
  if (!result.packCount && packOnly && !/\b(?:ab|bei)\s+$/.test(text.slice(0, packOnly.index))) {
    addPackCount(result, packOnly[1], 0.72);
    result.containerType = result.containerType || canonicalContainer(packOnly[2]);
  }

  const singleMeasure = firstRegexMatch(text, new RegExp(`\\b${numberPattern}\\s*${measurePattern}\\b`, 'g'));
  if (!result.unitSize && singleMeasure) {
    addMeasure(result, singleMeasure[1], singleMeasure[2]);
    result.quantityConfidence = Math.max(result.quantityConfidence, 0.68);
  }

  const hasExplicitSingleContainer = /\b(?:einzel|einzeldose|einzelpackung)\b/.test(text)
    || (!result.packCount && /\b(?:dose|flasche|packung)\b/.test(text) && Boolean(result.unitSize));

  if (result.packCount && result.unitSize && result.baseUnit) {
    result.totalQuantity = Number((result.packCount * result.unitSize).toFixed(4));
  } else if (!result.totalQuantity && result.unitSize && result.baseUnit && !result.packCount) {
    result.totalQuantity = result.unitSize;
  }

  if (!result.packCount && hasExplicitSingleContainer) {
    result.packCount = 1;
    result.quantityConfidence = Math.max(result.quantityConfidence, 0.7);
  }

  if (!result.baseUnit && result.packCount) {
    result.quantityConfidence = Math.max(result.quantityConfidence, 0.58);
  }

  if (!result.unitSize && !result.packCount && !result.totalQuantity) {
    result.unsafeQuantityReasons.push('quantity-missing');
  }

  if (hasExplicitSingleContainer && result.packCount === 1) {
    result.unsafeQuantityReasons.push('single-unit-explicit');
  }

  result.normalizedQuantityKey = [
    result.baseUnit || 'count',
    result.unitSize ? result.unitSize.toFixed(4) : '',
    result.packCount || '',
    result.totalQuantity ? result.totalQuantity.toFixed(4) : '',
    result.containerType || '',
    result.conditionPackCount || '',
    result.bundleMechanic || '',
  ].join('|');

  return result;
}

function diagnosticQuantityState(left = {}, right = {}) {
  const leftQuantity = normalizeDiagnosticQuantity(left);
  const rightQuantity = normalizeDiagnosticQuantity(right);
  const leftHasQuantity = Boolean(leftQuantity.unitSize || leftQuantity.packCount || leftQuantity.totalQuantity);
  const rightHasQuantity = Boolean(rightQuantity.unitSize || rightQuantity.packCount || rightQuantity.totalQuantity);

  if (!leftHasQuantity && !rightHasQuantity) {
    return { state: 'missing', leftQuantity, rightQuantity, unsafeQuantityReasons: ['quantity-missing-both'] };
  }
  if (!leftHasQuantity || !rightHasQuantity) {
    return { state: 'one-missing', leftQuantity, rightQuantity, unsafeQuantityReasons: ['quantity-missing-one-side'] };
  }

  const unsafe = [];
  const leftMultipack = Number(leftQuantity.packCount || 0) > 1;
  const rightMultipack = Number(rightQuantity.packCount || 0) > 1;
  const leftSingle = leftQuantity.unsafeQuantityReasons.includes('single-unit-explicit') || leftQuantity.packCount === 1;
  const rightSingle = rightQuantity.unsafeQuantityReasons.includes('single-unit-explicit') || rightQuantity.packCount === 1;

  if (leftQuantity.baseUnit && rightQuantity.baseUnit && leftQuantity.baseUnit !== rightQuantity.baseUnit) {
    unsafe.push('quantity-base-unit-conflict');
  }

  if (leftQuantity.unitSize && rightQuantity.unitSize && leftQuantity.baseUnit === rightQuantity.baseUnit && !nearlyEqual(leftQuantity.unitSize, rightQuantity.unitSize)) {
    const sameTotal = leftQuantity.totalQuantity && rightQuantity.totalQuantity && nearlyEqual(leftQuantity.totalQuantity, rightQuantity.totalQuantity);
    if (!sameTotal) unsafe.push('quantity-unit-size-conflict');
  }

  if (leftQuantity.packCount && rightQuantity.packCount && leftQuantity.packCount !== rightQuantity.packCount) {
    unsafe.push('quantity-pack-count-conflict');
  }

  if ((leftMultipack && rightSingle) || (rightMultipack && leftSingle)) {
    unsafe.push('single-vs-multipack-risk');
  }

  if (
    leftQuantity.totalQuantity
    && rightQuantity.totalQuantity
    && leftQuantity.baseUnit === rightQuantity.baseUnit
    && !nearlyEqual(leftQuantity.totalQuantity, rightQuantity.totalQuantity)
  ) {
    unsafe.push('quantity-total-conflict');
  }

  if (unsafe.length > 0) {
    return { state: 'conflict', leftQuantity, rightQuantity, unsafeQuantityReasons: uniq(unsafe) };
  }

  const sameUnit = leftQuantity.baseUnit && leftQuantity.baseUnit === rightQuantity.baseUnit;
  const samePack = leftQuantity.packCount && rightQuantity.packCount && leftQuantity.packCount === rightQuantity.packCount;
  const sameUnitSize = leftQuantity.unitSize && rightQuantity.unitSize && nearlyEqual(leftQuantity.unitSize, rightQuantity.unitSize);
  const sameTotal = leftQuantity.totalQuantity && rightQuantity.totalQuantity && sameUnit && nearlyEqual(leftQuantity.totalQuantity, rightQuantity.totalQuantity);

  if ((samePack && sameUnitSize && sameUnit) || (samePack && sameTotal) || (!leftMultipack && !rightMultipack && sameTotal)) {
    return { state: 'same', leftQuantity, rightQuantity, unsafeQuantityReasons: [] };
  }

  if (sameTotal && (leftMultipack || rightMultipack)) {
    return { state: 'partial', leftQuantity, rightQuantity, unsafeQuantityReasons: [] };
  }

  if ((sameUnitSize && sameUnit && !leftMultipack && !rightMultipack) || (samePack && !leftQuantity.unitSize && !rightQuantity.unitSize)) {
    return { state: 'same', leftQuantity, rightQuantity, unsafeQuantityReasons: [] };
  }

  return { state: 'one-missing', leftQuantity, rightQuantity, unsafeQuantityReasons: ['quantity-partial-evidence'] };
}

function quantityState(left = {}, right = {}) {
  return diagnosticQuantityState(left, right).state;
}

function categoryText(offer = {}) {
  return normalizeText([
    offer.categoryPrimary,
    offer.categorySecondary,
    offer.categoryKey,
    offer.subcategoryKey,
  ].join(' '));
}

function hasCategoryTerm(category, terms = []) {
  const padded = ` ${category.replace(/-/g, ' ')} `;
  return terms.some((term) => padded.includes(` ${normalizeText(term)} `));
}

function productTokenStrength(left = {}, right = {}) {
  const leftTokens = offerTokens(left);
  const rightTokens = offerTokens(right);
  const shared = uniq(leftTokens.filter((token) => rightTokens.includes(token)));
  return {
    shared,
    strong: shared.length >= 2 || (brandState(left, right) === 'same' && shared.length >= 1),
  };
}

function categoryState(left = {}, right = {}) {
  const leftCategory = normalizeKey(left.subcategoryKey || left.categoryKey || left.categorySecondary || left.categoryPrimary || '');
  const rightCategory = normalizeKey(right.subcategoryKey || right.categoryKey || right.categorySecondary || right.categoryPrimary || '');
  if (!leftCategory || !rightCategory) return 'missing';
  if (leftCategory === rightCategory) return 'same';

  const leftText = categoryText(left);
  const rightText = categoryText(right);
  const combinedOfferText = normalizeText(`${offerText(left)} ${offerText(right)}`);
  const tokens = productTokenStrength(left, right);
  const leftPet = hasCategoryTerm(leftText, ['tierfutter', 'hundefutter', 'katzenfutter']);
  const rightPet = hasCategoryTerm(rightText, ['tierfutter', 'hundefutter', 'katzenfutter']);
  const leftDrugstore = hasCategoryTerm(leftText, ['drogerie', 'haushalt', 'hygiene', 'waschmittel']);
  const rightDrugstore = hasCategoryTerm(rightText, ['drogerie', 'haushalt', 'hygiene', 'waschmittel']);
  const leftFood = hasCategoryTerm(leftText, ['lebensmittel', 'fleisch', 'wurst', 'fisch', 'obst', 'gemuese', 'milch', 'butter', 'kaese', 'getraenke', 'bier']);
  const rightFood = hasCategoryTerm(rightText, ['lebensmittel', 'fleisch', 'wurst', 'fisch', 'obst', 'gemuese', 'milch', 'butter', 'kaese', 'getraenke', 'bier']);

  if ((leftPet && rightFood) || (rightPet && leftFood)) return 'conflict';
  if ((leftDrugstore && rightFood) || (rightDrugstore && leftFood)) return tokens.strong ? 'compatible' : 'conflict';

  const leftBeerFamily = hasCategoryTerm(leftText, ['bier', 'getraenke', 'alkoholische getraenke', 'alkohol']);
  const rightBeerFamily = hasCategoryTerm(rightText, ['bier', 'getraenke', 'alkoholische getraenke', 'alkohol']);
  if (leftBeerFamily && rightBeerFamily && /(bier|maerzen|radler|lager|pils|weizen)/.test(combinedOfferText)) return 'compatible';

  const leftMeatFamily = hasCategoryTerm(leftText, ['fleisch', 'wurst', 'grillfleisch']);
  const rightMeatFamily = hasCategoryTerm(rightText, ['fleisch', 'wurst', 'grillfleisch']);
  const leftFishFamily = hasCategoryTerm(leftText, ['fisch', 'lachs']);
  const rightFishFamily = hasCategoryTerm(rightText, ['fisch', 'lachs']);
  const leftFrozen = hasCategoryTerm(leftText, ['tiefkuehl', 'tiefkuhl', 'tiefkuehlkost', 'tiefkuhlkost']);
  const rightFrozen = hasCategoryTerm(rightText, ['tiefkuehl', 'tiefkuhl', 'tiefkuehlkost', 'tiefkuhlkost']);

  if ((leftMeatFamily && rightFishFamily) || (rightMeatFamily && leftFishFamily)) return 'conflict';
  if (leftMeatFamily && rightMeatFamily && tokens.strong) return 'compatible';
  if (((leftFishFamily && (rightFishFamily || rightFrozen)) || (rightFishFamily && (leftFishFamily || leftFrozen))) && tokens.strong) return 'compatible';

  const leftProduce = hasCategoryTerm(leftText, ['obst', 'gemuese', 'gemuse']);
  const rightProduce = hasCategoryTerm(rightText, ['obst', 'gemuese', 'gemuse']);
  if (leftProduce && rightProduce && tokens.strong) return 'compatible';

  if ((leftFood && rightFood) && tokens.strong && hasCategoryTerm(`${leftText} ${rightText}`, ['lebensmittel'])) return 'compatible';

  return 'conflict';
}

function brandState(left = {}, right = {}) {
  const leftBrand = normalizeKey(left.brand || '');
  const rightBrand = normalizeKey(right.brand || '');
  if (!leftBrand || !rightBrand) return 'missing';
  return leftBrand === rightBrand ? 'same' : 'different';
}

function hasAny(text, terms = []) {
  const normalized = ` ${normalizeText(text)} `;
  return terms.some((term) => normalized.includes(` ${normalizeText(term)} `));
}

function mechanicTokens(offer = {}) {
  const rawText = String(`${offer.title || ''} ${offer.conditionsText || ''} ${offer.rawFacts?.validityText || ''}`).toLowerCase();
  const text = normalizeText(rawText);
  const tokens = [];

  const plusGratis = rawText.match(/\b(\d+)\s*\+\s*(\d+)\b/);
  const forMechanic = rawText.match(/\b(\d+)\s*f(?:ue|\u00fc|u)r\s*(\d+)\b/);
  if (plusGratis) tokens.push(`${plusGratis[1]}+${plusGratis[2]}-gratis`);
  if (forMechanic) tokens.push(`${forMechanic[1]}-for-${forMechanic[2]}`);
  if (/\bab\s+\d+\b|\bmindestkauf\b/.test(text)) tokens.push('threshold');
  if (/%|pickerl|rabattmarke|joker/.test(text)) tokens.push('percent-or-sticker');
  if (/kundenkarte|app|konto|s-budget-card|spar-app/.test(text)) tokens.push('loyalty');

  return uniq(tokens);
}

function mechanicsCompatible(left = {}, right = {}) {
  const leftTokens = mechanicTokens(left);
  const rightTokens = mechanicTokens(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) return true;
  return leftTokens.some((token) => rightTokens.includes(token));
}

const VARIANT_IGNORE_WORDS = new Set([
  ...STOP_WORDS,
  'einzel',
  'einzeldose',
  'gebinde',
  'tray',
  'trays',
  'mehrweg',
  'mw',
  'pfand',
  'preis',
]);

function identityTokens(offer = {}) {
  return offerTokens(offer).filter((token) => !VARIANT_IGNORE_WORDS.has(token));
}

function variantConflict(left = {}, right = {}) {
  const leftTokens = new Set(identityTokens(left));
  const rightTokens = new Set(identityTokens(right));
  const shared = [...leftTokens].filter((token) => rightTokens.has(token));
  const leftOnly = [...leftTokens].filter((token) => !rightTokens.has(token));
  const rightOnly = [...rightTokens].filter((token) => !leftTokens.has(token));

  if (shared.length < 1 || leftOnly.length === 0 || rightOnly.length === 0) return false;
  if (brandState(left, right) === 'same' && leftOnly.length <= 4 && rightOnly.length <= 4) return true;
  return shared.length >= 2 && leftOnly.length <= 3 && rightOnly.length <= 3;
}

function alcoholFreeConflict(left = {}, right = {}) {
  const leftText = normalizeText(offerText(left));
  const rightText = normalizeText(offerText(right));
  const alcoholProduct = /(bier|maerzen|radler|lager|pils|weizen|alkoholisch)/;
  const leftAlcoholFree = leftText.includes('alkoholfrei');
  const rightAlcoholFree = rightText.includes('alkoholfrei');

  return leftAlcoholFree !== rightAlcoholFree && (alcoholProduct.test(leftText) || alcoholProduct.test(rightText));
}

function detectUnsafeReasons(left = {}, right = {}, states = {}) {
  const unsafe = [];
  const text = `${offerText(left)} ${offerText(right)}`;

  if (states.format !== 'same') unsafe.push('retailer-format-conflict');
  if (states.price === 'conflict') unsafe.push('price-conflict');
  if (states.quantity === 'conflict') unsafe.push('quantity-conflict');
  if (states.category === 'conflict') unsafe.push('category-conflict');
  if (!validityCompatible(left, right)) unsafe.push('validity-conflict');
  if (states.variantConflict) unsafe.push('variant-or-sort-conflict');
  if (!mechanicsCompatible(left, right)) unsafe.push('promotion-mechanic-conflict');
  if (hasAny(text, ['kaffee', 'caffe', 'espresso']) && hasAny(text, ['tee', 'teebutter'])) unsafe.push('coffee-tea-teebutter-collision');
  if (hasAny(text, ['hundefutter', 'katzenfutter', 'tierfutter']) && hasAny(text, ['fleisch', 'wurst', 'fisch', 'lebensmittel'])) unsafe.push('pet-food-human-food-collision');
  if (alcoholFreeConflict(left, right)) unsafe.push('alcoholic-nonalcoholic-variant-risk');
  if (hasAny(text, ['fleisch']) && hasAny(text, ['fisch']) && states.category !== 'same' && states.category !== 'compatible') unsafe.push('meat-fish-sausage-category-risk');

  const leftTitle = normalizeText(left.title || '');
  const rightTitle = normalizeText(right.title || '');
  if ((leftTitle.includes('div sorten') || rightTitle.includes('div sorten')) && states.titleSimilarity < 0.75) {
    unsafe.push('generic-diverse-sorten-title');
  }

  return uniq(unsafe);
}

function conflictingFields(left = {}, right = {}, states = {}) {
  const fields = [];
  if (states.format !== 'same') fields.push({ field: 'retailerFormat', pdf: retailerFormatForOffer(left), aggregator: retailerFormatForOffer(right) });
  if (states.price === 'conflict') fields.push({ field: 'priceCurrent', pdf: left.priceCurrent?.amount ?? null, aggregator: right.priceCurrent?.amount ?? null });
  if (states.quantity === 'conflict') fields.push({ field: 'quantity', pdf: left.quantityText || quantitySignature(left), aggregator: right.quantityText || quantitySignature(right) });
  if (states.category === 'conflict') fields.push({ field: 'category', pdf: left.subcategoryKey || left.categoryKey || left.categorySecondary || '', aggregator: right.subcategoryKey || right.categoryKey || right.categorySecondary || '' });
  if (!validityCompatible(left, right)) fields.push({ field: 'validity', pdf: [dateKey(left.validFrom), dateKey(left.validTo)].filter(Boolean).join(' - '), aggregator: [dateKey(right.validFrom), dateKey(right.validTo)].filter(Boolean).join(' - ') });
  if (!mechanicsCompatible(left, right)) fields.push({ field: 'conditionsText', pdf: left.conditionsText || '', aggregator: right.conditionsText || '' });
  return fields;
}

function buildOfferPreview(offer = {}) {
  return {
    id: String(offer._id || offer.id || ''),
    retailerKey: offer.retailerKey || '',
    retailerFormat: retailerFormatForOffer(offer),
    sourceKey: sourceKeyForOffer(offer),
    sourceType: sourceTypeForOffer(offer),
    title: offer.title || '',
    brand: offer.brand || '',
    priceCurrent: offer.priceCurrent?.amount ?? null,
    quantityText: offer.quantityText || '',
    unitValue: offer.unitValue ?? null,
    unitType: offer.unitType || '',
    validFrom: dateKey(offer.validFrom),
    validTo: dateKey(offer.validTo),
    categoryPrimary: offer.categoryPrimary || '',
    categorySecondary: offer.categorySecondary || '',
    categoryKey: offer.categoryKey || '',
    subcategoryKey: offer.subcategoryKey || '',
    conditionsText: offer.conditionsText || '',
    imageUrl: offer.imageUrl || '',
    comparisonSafe: offer.quality?.comparisonSafe ?? offer.comparisonSafe ?? null,
    comparisonSafeReason: offer.comparisonSafeReason || '',
  };
}

function scorePair(pdfOffer = {}, aggregatorOffer = {}) {
  const pdfFormat = retailerFormatForOffer(pdfOffer);
  const aggregatorFormat = retailerFormatForOffer(aggregatorOffer);
  const leftTokens = offerTokens(pdfOffer);
  const rightTokens = offerTokens(aggregatorOffer);
  const sharedTokens = uniq(leftTokens.filter((token) => rightTokens.includes(token))).sort();
  const titleSimilarity = Number(jaccard(leftTokens, rightTokens).toFixed(3));
  const quantityDiagnostic = diagnosticQuantityState(pdfOffer, aggregatorOffer);
  const states = {
    format: pdfFormat && aggregatorFormat && pdfFormat === aggregatorFormat ? 'same' : 'conflict',
    brand: brandState(pdfOffer, aggregatorOffer),
    price: priceState(pdfOffer, aggregatorOffer),
    quantity: quantityDiagnostic.state,
    quantityUnsafeReasons: quantityDiagnostic.unsafeQuantityReasons,
    category: categoryState(pdfOffer, aggregatorOffer),
    titleSimilarity,
  };
  states.variantConflict = variantConflict(pdfOffer, aggregatorOffer);

  const reasons = [];
  let score = 0;

  if (states.format === 'same') {
    score += 12;
    reasons.push('same-retailer-format');
  }
  if (states.brand === 'same') {
    score += 13;
    reasons.push('same-brand');
  }
  if (titleSimilarity >= 0.85) {
    score += 30;
    reasons.push('title-strongly-compatible');
  } else if (titleSimilarity >= 0.55) {
    score += 21;
    reasons.push('title-compatible');
  } else if (titleSimilarity >= 0.3 || sharedTokens.length >= 2) {
    score += 10;
    reasons.push('title-loosely-compatible');
  }
  if (states.price === 'same') {
    score += 18;
    reasons.push('same-price');
  } else if (states.price === 'close') {
    score += 9;
    reasons.push('similar-price');
  }
  if (states.quantity === 'same') {
    score += 18;
    reasons.push('same-quantity');
  } else if (states.quantity === 'partial') {
    score += 10;
    reasons.push('quantity-partially-compatible');
  } else if (states.quantity === 'one-missing') {
    score += 6;
    reasons.push('quantity-missing-one-side');
  }
  if (states.category === 'same') {
    score += 5;
    reasons.push('same-category');
  } else if (states.category === 'compatible') {
    score += 4;
    reasons.push('category-compatible');
  } else if (states.category === 'missing') {
    score += 2;
    reasons.push('category-missing-one-side');
  }
  if (validityCompatible(pdfOffer, aggregatorOffer)) {
    score += hasValidity(pdfOffer) && hasValidity(aggregatorOffer) ? 4 : 1;
    reasons.push('validity-compatible');
  }
  if (mechanicsCompatible(pdfOffer, aggregatorOffer)) {
    score += 2;
    if (mechanicTokens(pdfOffer).length || mechanicTokens(aggregatorOffer).length) reasons.push('promotion-mechanic-compatible');
  }

  const unsafeReasons = detectUnsafeReasons(pdfOffer, aggregatorOffer, states);
  const hasRedUnsafe = unsafeReasons.length > 0;
  if (hasRedUnsafe) score = Math.min(score, 59);
  if (states.price === 'same' && sharedTokens.length === 0 && states.brand !== 'same') {
    unsafeReasons.push('price-only-match');
    score = Math.min(score, 34);
  }

  const hasStrongIdentity = states.brand === 'same' && (titleSimilarity >= 0.72 || sharedTokens.length >= 2);
  const hasQuantityForStrong = states.quantity === 'same';
  const hasSafePriceForStrong = states.price === 'same' || states.price === 'close';
  let matchLevel = 'none';

  if (
    score >= 82
    && states.format === 'same'
    && hasStrongIdentity
    && hasQuantityForStrong
    && hasSafePriceForStrong
    && states.category !== 'conflict'
    && unsafeReasons.length === 0
  ) {
    matchLevel = 'strong';
  } else if (
    score >= 62
    && states.format === 'same'
    && unsafeReasons.length === 0
    && (hasStrongIdentity || (states.brand === 'same' && states.price !== 'missing'))
    && states.price !== 'conflict'
    && states.quantity !== 'conflict'
  ) {
    matchLevel = 'medium';
  } else if (score >= 35 && states.format === 'same' && !unsafeReasons.includes('retailer-format-conflict')) {
    matchLevel = 'weak';
  }

  const canUseAggregatorImage = matchLevel === 'strong' && Boolean(aggregatorOffer.imageUrl);
  const canUsePdfValidity = matchLevel === 'strong'
    || (matchLevel === 'medium' && states.price === 'same' && states.quantity === 'same' && unsafeReasons.length === 0);
  const canUsePdfConditions = (matchLevel === 'strong' || canUsePdfValidity)
    && mechanicsCompatible(pdfOffer, aggregatorOffer)
    && Boolean(pdfOffer.conditionsText || aggregatorOffer.conditionsText);

  return {
    pdfOffer: buildOfferPreview(pdfOffer),
    aggregatorOffer: buildOfferPreview(aggregatorOffer),
    matchLevel,
    matchScore: Math.max(0, Math.min(100, Math.round(score))),
    reasons: uniq(reasons),
    unsafeReasons: uniq(unsafeReasons),
    conflictingFields: conflictingFields(pdfOffer, aggregatorOffer, states),
    quantityDiagnostics: {
      state: states.quantity,
      pdf: quantityDiagnostic.leftQuantity,
      aggregator: quantityDiagnostic.rightQuantity,
      unsafeQuantityReasons: quantityDiagnostic.unsafeQuantityReasons,
    },
    sharedTokens,
    titleSimilarity,
    canUseAggregatorImage,
    canUsePdfValidity,
    canUsePdfConditions,
    shouldMergeLater: matchLevel === 'strong' && unsafeReasons.length === 0,
  };
}

function bestCandidatesForPdfOffer(pdfOffer = {}, aggregatorOffers = [], { maxCandidates = 3 } = {}) {
  const candidates = aggregatorOffers
    .map((aggregatorOffer) => scorePair(pdfOffer, aggregatorOffer))
    .filter((candidate) => candidate.matchLevel !== 'none' || candidate.matchScore >= 25 || candidate.unsafeReasons.length > 0)
    .sort((left, right) => right.matchScore - left.matchScore || left.aggregatorOffer.title.localeCompare(right.aggregatorOffer.title))
    .slice(0, maxCandidates);
  const best = candidates[0] || null;

  return {
    pdfOffer: buildOfferPreview(pdfOffer),
    bestAggregatorCandidates: candidates,
    matchLevel: best?.matchLevel || 'none',
    matchScore: best?.matchScore || 0,
    reasons: best?.reasons || [],
    unsafeReasons: best?.unsafeReasons || [],
    conflictingFields: best?.conflictingFields || [],
    canUseAggregatorImage: Boolean(best?.canUseAggregatorImage),
    canUsePdfValidity: Boolean(best?.canUsePdfValidity),
    canUsePdfConditions: Boolean(best?.canUsePdfConditions),
    shouldMergeLater: Boolean(best?.shouldMergeLater),
  };
}

function increment(map, key) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + 1);
}

function histogram(values = []) {
  const counts = new Map();
  for (const value of values) increment(counts, value);
  return Object.fromEntries([...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])));
}

function categoryKeyForOffer(offer = {}) {
  return offer.subcategoryKey || offer.categoryKey || offer.categorySecondary || offer.categoryPrimary || 'unknown';
}

function buildBreakdown(rows = [], keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    if (!map.has(key)) {
      map.set(key, { totalPdfOffers: 0, matchedStrong: 0, matchedMedium: 0, matchedWeak: 0, matchedNone: 0 });
    }
    const bucket = map.get(key);
    bucket.totalPdfOffers += 1;
    bucket[`matched${row.matchLevel[0].toUpperCase()}${row.matchLevel.slice(1)}`] += 1;
  }
  return Object.fromEntries([...map.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function buildRecommendedNextActions(summary = {}) {
  const actions = [
    'Run this diagnostic read-only against current Production offers before any source merge or image fallback.',
    'Manually inspect strong image-transfer candidates first; false images remain worse than missing images.',
  ];

  if (summary.matchedNone > 0) {
    actions.push('Review topNoMatchExamples against current SPAR flyer screenshots to separate parser loss from missing aggregator coverage.');
  }

  if (summary.unsafeExamples > 0) {
    actions.push('Keep unsafe examples out of merge logic and add fixture tests for recurring unsafe patterns.');
  }

  if (summary.topRejectedCandidateSamples > 0) {
    actions.push('Use rejection samples to decide parser fixes; do not loosen parser gates without fixture-backed precision checks.');
  }

  return actions;
}

function buildSparSourceMatchingDiagnostic({
  offers = [],
  rejectedCandidateSamples = [],
  generatedAt = new Date(),
  maxCandidates = 3,
  maxExamples = 8,
} = {}) {
  const relevant = offers.filter((offer) => TARGET_RETAILERS.includes(retailerFormatForOffer(offer) || offer.retailerKey));
  const pdfOffers = relevant.filter(isPdfOffer);
  const aggregatorOffers = relevant.filter(isAggregatorOffer);
  const rows = pdfOffers.map((pdfOffer) => bestCandidatesForPdfOffer(pdfOffer, aggregatorOffers, { maxCandidates }));
  const matchedStrong = rows.filter((row) => row.matchLevel === 'strong').length;
  const matchedMedium = rows.filter((row) => row.matchLevel === 'medium').length;
  const matchedWeak = rows.filter((row) => row.matchLevel === 'weak').length;
  const matchedNone = rows.filter((row) => row.matchLevel === 'none').length;
  const unsafeRows = rows.filter((row) => row.unsafeReasons.length > 0);
  const summary = {
    totalPdfOffers: pdfOffers.length,
    totalAggregatorOffers: aggregatorOffers.length,
    matchedStrong,
    matchedMedium,
    matchedWeak,
    matchedNone,
    imageTransferCandidates: rows.filter((row) => row.canUseAggregatorImage).length,
    validityTransferCandidates: rows.filter((row) => row.canUsePdfValidity).length,
    conditionTransferCandidates: rows.filter((row) => row.canUsePdfConditions).length,
    unsafeExamples: unsafeRows.length,
    topRejectedCandidateSamples: rejectedCandidateSamples.length,
  };

  return {
    ok: true,
    readOnly: true,
    mutatedCollections: [],
    generatedAt: generatedAt instanceof Date ? generatedAt.toISOString() : generatedAt,
    scope: {
      retailerFormats: TARGET_RETAILERS,
      pdfSourceKeys: [...PDF_SOURCE_KEYS],
      pdfSourceType: PDF_SOURCE_TYPE,
      aggregatorSourceKeys: [...AGGREGATOR_SOURCE_KEYS],
      aggregatorSourceType: AGGREGATOR_SOURCE_TYPE,
    },
    summary,
    totalPdfOffers: summary.totalPdfOffers,
    totalAggregatorOffers: summary.totalAggregatorOffers,
    matchedStrong,
    matchedMedium,
    matchedWeak,
    matchedNone,
    imageTransferCandidates: summary.imageTransferCandidates,
    validityTransferCandidates: summary.validityTransferCandidates,
    conditionTransferCandidates: summary.conditionTransferCandidates,
    unsafeExamples: unsafeRows
      .sort((left, right) => right.matchScore - left.matchScore)
      .slice(0, maxExamples),
    topStrongExamples: rows.filter((row) => row.matchLevel === 'strong').sort((left, right) => right.matchScore - left.matchScore).slice(0, maxExamples),
    topMediumExamples: rows.filter((row) => row.matchLevel === 'medium').sort((left, right) => right.matchScore - left.matchScore).slice(0, maxExamples),
    topNoMatchExamples: rows.filter((row) => row.matchLevel === 'none').slice(0, maxExamples),
    topRejectedCandidateSamples: rejectedCandidateSamples.slice(0, maxExamples),
    perRetailerBreakdown: {
      spar: buildBreakdown(rows.filter((row) => row.pdfOffer.retailerFormat === 'spar'), () => 'spar').spar || { totalPdfOffers: 0, matchedStrong: 0, matchedMedium: 0, matchedWeak: 0, matchedNone: 0 },
      interspar: buildBreakdown(rows.filter((row) => row.pdfOffer.retailerFormat === 'interspar'), () => 'interspar').interspar || { totalPdfOffers: 0, matchedStrong: 0, matchedMedium: 0, matchedWeak: 0, matchedNone: 0 },
      eurospar: buildBreakdown(rows.filter((row) => row.pdfOffer.retailerFormat === 'eurospar'), () => 'eurospar').eurospar || { totalPdfOffers: 0, matchedStrong: 0, matchedMedium: 0, matchedWeak: 0, matchedNone: 0 },
    },
    perCategoryBreakdown: buildBreakdown(rows, (row) => categoryKeyForOffer(row.pdfOffer)),
    reasonHistogram: histogram(rows.flatMap((row) => row.reasons)),
    unsafeReasonHistogram: histogram(rows.flatMap((row) => row.unsafeReasons)),
    rejectionReasonHistogram: histogram(rejectedCandidateSamples.map((sample) => sample.reason)),
    matches: rows,
    recommendedNextActions: buildRecommendedNextActions(summary),
  };
}

function truncate(value, maxLength = 260) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
}

function extractTokens(text = '', pattern) {
  return uniq([...String(text || '').matchAll(pattern)].map((match) => match[0])).slice(0, 8);
}

function candidateTitleHint(candidate = {}) {
  if (candidate.title) return truncate(candidate.title, 90);
  const text = String(candidate.rawText || candidate.snippet || '');
  return truncate(text
    .replace(/\b\d{1,3}[,.]\d{2}\b/g, ' ')
    .replace(/\b\d+(?:[,.]\d+)?\s*(?:kg|g|l|ml|stk|stueck|kapseln|dosen|flaschen|kisten)\b/ig, ' ')
    .replace(/\s+/g, ' '), 90);
}

function buildSparPdfRejectedCandidateEvidence({
  candidates = [],
  sourceKey = '',
  retailerKey = '',
  validityContext = '',
  createdAt = new Date(),
  maxSamplesPerSourceReason = 5,
  maxSnippetLength = 260,
} = {}) {
  const samples = [];
  const counts = new Map();

  for (const candidate of candidates) {
    const reason = candidate?.exclusionReason || candidate?.reason || '';
    if (!reason) continue;

    const resolvedSourceKey = candidate.sourceKey || sourceKey || sourceKeyForFormat(candidate.sourceRetailerFormat || retailerKey || 'spar');
    const resolvedRetailerKey = candidate.retailerKey || retailerKey || retailerFormatForOffer(candidate);
    const bucketKey = `${resolvedSourceKey}::${reason}`;
    const count = counts.get(bucketKey) || 0;
    if (count >= maxSamplesPerSourceReason) continue;
    counts.set(bucketKey, count + 1);

    const snippetSource = candidate.rawText || candidate.snippet || candidate.sourceText || '';
    samples.push({
      sourceKey: resolvedSourceKey,
      retailerKey: resolvedRetailerKey,
      reason,
      stage: candidate.stage || candidate.parserHint || 'pdf-candidate-filter',
      page: candidate.page ?? candidate.pageNumber ?? null,
      blockIndex: candidate.blockIndex ?? null,
      snippet: truncate(snippetSource, maxSnippetLength),
      nearbyPriceTokens: extractTokens(snippetSource, /\b\d{1,3}[,.]\d{2}\b/g),
      nearbyQuantityTokens: extractTokens(snippetSource, /\b\d+(?:[,.]\d+)?\s*(?:kg|g|l|ml|stk|stueck|kapseln|dosen|flaschen|kisten)\b/ig),
      nearbyConditionTokens: extractTokens(snippetSource, /\b(?:1\+1|2\s*fuer\s*1|ab\s+\d+|gratis|pickerl|rabatt|kundenkarte|app|konto|joker)\b/ig),
      candidateTitleHint: candidateTitleHint({ ...candidate, snippet: snippetSource }),
      validityContext: truncate(candidate.validityContext || validityContext, 120),
      createdAt: createdAt instanceof Date ? createdAt.toISOString() : createdAt,
    });
  }

  return samples;
}

function writeDiagnosticArtifact(report, { baseDir = process.cwd(), generatedAt = new Date() } = {}) {
  const stamp = (generatedAt instanceof Date ? generatedAt : new Date(generatedAt))
    .toISOString()
    .replace(/[:.]/g, '-');
  const dir = path.join(baseDir, 'tmp', 'diagnostics', `spar-source-matching-${stamp}`);
  const file = path.join(dir, 'spar-source-matching.json');

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(report, null, 2));

  return file;
}

module.exports = {
  AGGREGATOR_SOURCE_KEYS,
  AGGREGATOR_SOURCE_TYPE,
  PDF_SOURCE_KEYS,
  PDF_SOURCE_TYPE,
  TARGET_RETAILERS,
  bestCandidatesForPdfOffer,
  buildSparPdfRejectedCandidateEvidence,
  buildSparSourceMatchingDiagnostic,
  retailerFormatForOffer,
  scorePair,
  sourceKeyForOffer,
  sourceTypeForOffer,
  writeDiagnosticArtifact,
};
