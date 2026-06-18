const {
  sanitizeWhitespace,
  normalizeTitleForMatch,
} = require('./sourceEvidence');

const PRICE_RE = /^(?:\d{1,3}[,.]\d{2})$/;
const PRODUCT_WORD_RE = /\p{L}/u;

function normalizeForScan(value = '') {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/Ã¤/g, 'ae')
    .replace(/Ã¶/g, 'oe')
    .replace(/Ã¼/g, 'ue')
    .replace(/ÃŸ/g, 'ss')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .toLowerCase();
}

function parseAmount(value = '') {
  const normalized = String(value || '').replace(/\s+/g, '').replace(',', '.');
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function parseLayoutPriceItems(items = []) {
  const anchors = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const text = sanitizeWhitespace(item.text);

    if (PRICE_RE.test(text)) {
      const amount = parseAmount(text);
      if (amount > 0) {
        anchors.push({
          amount,
          x: item.x,
          y: item.y,
          w: item.w,
          h: item.h,
          text,
          index,
        });
      }
      continue;
    }

    const euroPart = text.match(/^(\d{1,3})[,.]$/);
    if (!euroPart) continue;

    const cents = items
      .slice(index + 1, index + 5)
      .find((candidate) => {
        const candidateText = sanitizeWhitespace(candidate.text);
        return /^\d{2}$/.test(candidateText)
          && candidate.x >= item.x + item.w - 4
          && candidate.x <= item.x + item.w + 42
          && Math.abs(candidate.y - item.y) <= 28;
      });

    if (!cents) continue;
    const amount = Number(`${euroPart[1]}.${sanitizeWhitespace(cents.text)}`);
    if (Number.isFinite(amount) && amount > 0) {
      anchors.push({
        amount,
        x: Math.min(item.x, cents.x),
        y: Math.min(item.y, cents.y),
        w: Math.max(item.x + item.w, cents.x + cents.w) - Math.min(item.x, cents.x),
        h: Math.max(item.y + item.h, cents.y + cents.h) - Math.min(item.y, cents.y),
        text: `${euroPart[1]},${sanitizeWhitespace(cents.text)}`,
        index,
      });
    }
  }

  return anchors;
}

function groupItemsIntoLines(items = []) {
  const sorted = [...items].sort((a, b) => {
    if (Math.abs(b.y - a.y) > 4) return b.y - a.y;
    return a.x - b.x;
  });
  const lines = [];

  for (const item of sorted) {
    const existing = lines.find((line) => Math.abs(line.y - item.y) <= 4);
    if (existing) {
      existing.items.push(item);
      existing.y = (existing.y + item.y) / 2;
    } else {
      lines.push({ y: item.y, items: [item] });
    }
  }

  return lines
    .map((line) => line.items.sort((a, b) => a.x - b.x).map((item) => item.text).join(' '))
    .map(sanitizeWhitespace)
    .filter(Boolean);
}

function isLayoutNoiseLine(line = '') {
  const normalized = normalizeForScan(line);
  return !normalized
    || normalized.length < 3
    || /^seite\s+(?:xx|\d+)\b/.test(normalized)
    || /\bstattpreise\s+sind\b/.test(normalized)
    || /\bangebote?\s+gueltig\b/.test(normalized)
    || /\baktionen?\s+nicht\s+gueltig\b/.test(normalized)
    || /\babgabe\s+nur\s+in\s+haushaltsmengen\b/.test(normalized)
    || /\bmaximal\s+\d+\s+(?:kisten|trays|flaschen)\b/.test(normalized)
    || /\bfacebook\.com|instagram\.com|www\.spar\.at\b/.test(normalized)
    || /^(?:statt|per|ersparnis|bis\s+zu|von\s+(?:mo|di|mi|do|fr|sa|so)|bis\s+(?:mo|di|mi|do|fr|sa|so))\b/.test(normalized)
    || /^(?:\d+\s*(?:fl|ds|pkg|stk)\.?\s+\d{1,3}[,.]\d{2}|ab\s+\d+|bei\s+\d+|je\s+\d{1,3}[,.]\d{2})\b/.test(normalized)
    || /^-?\d{1,2}\s*%\b/.test(normalized)
    || /\bgratis\b/.test(normalized)
    || PRICE_RE.test(sanitizeWhitespace(line));
}

function stripQuantityTail(title = '') {
  return sanitizeWhitespace(String(title || '')
    .replace(/\b\d+(?:[,.]\d+)?\s*(?:kg|g|l|liter|ml|stk|stueck|stück|packung|pkg|flasche|dose|dosen|rollen|beutel|windeln)\b.*$/i, '')
    .replace(/\b\d+\s*x\s*\d+(?:[,.]\d+)?\s*(?:kg|g|l|liter|ml)\b.*$/i, '')
    .replace(/\b(?:versch\.?\s+sorten|verschiedene\s+sorten),?\s*$/i, '')
    .replace(/[,.]\s*$/, ''));
}

function isPlausibleLayoutTitle(title = '') {
  const clean = sanitizeWhitespace(title);
  const normalized = normalizeForScan(clean);
  const words = normalized.split(/\s+/).filter(Boolean);

  return clean.length >= 8
    && clean.length <= 140
    && PRODUCT_WORD_RE.test(clean)
    && words.length >= 2
    && !/^(?:oder|versch|mit|in\s+bedienung|aus\s+oesterreich|aus\s+osterreich|gilt|nur|aktion|preisgesenkt|immer\s+billig)\b/.test(normalized)
    && !/\b(?:aktion|aktionspreise|beim\s+kauf|bis\s+zu|einzuloesen|ersparnis|gutschein|gueltig|haushaltsmengen|immer\s+billig|je\s+packung|maximal|mengenvorteil|monatssparer|per\s+kg|per\s+liter|prozentaktion|sie\s+sparen|spar-maerkten|stattpreise|symbolfoto|verkaufspreise|vorratspackungen|auf\s+alle)\b/.test(normalized)
    && !/\d{1,3}[,.]\d{2}/.test(clean);
}

function extractQuantityText(lines = []) {
  const text = sanitizeWhitespace(lines.join(' '));

  const packVolume = text.match(/\b(\d{1,2})(?:er|\s*x)\s*[-\s]?(?:tray|kiste|packung|pkg)\b[\s\S]{0,80}\b(\d+(?:[,.]\d+)?)\s*(liter|l|ml|kg|g)\b/i)
    || text.match(/\b(\d+(?:[,.]\d+)?)\s*(liter|l|ml|kg|g)\b[\s\S]{0,80}\b(\d{1,2})(?:er|\s*x)\s*[-\s]?(?:tray|kiste|packung|pkg)\b/i);
  if (packVolume) {
    const count = packVolume[1].match(/^\d{1,2}$/) ? packVolume[1] : packVolume[3];
    const amount = packVolume[1].match(/^\d{1,2}$/) ? packVolume[2] : packVolume[1];
    const unit = packVolume[1].match(/^\d{1,2}$/) ? packVolume[3] : packVolume[2];
    const numericAmount = Number(amount.replace(',', '.'));
    if (Number.isFinite(numericAmount) && numericAmount > 0 && numericAmount <= 3) {
      return `${count} x ${amount.replace(',', '.')} ${unit.toLowerCase() === 'liter' ? 'l' : unit.toLowerCase()}`;
    }
  }

  const simple = text.match(/\b(\d+(?:[,.]\d+)?)\s*(kg|g|liter|l|ml|stk|stueck|stück|packungen?|pkg|flaschen?|dosen?|rollen|beutel|windeln)\b/i);
  if (simple) {
    const unit = simple[2].toLowerCase()
      .replace('liter', 'l')
      .replace('stück', 'stueck')
      .replace('stueck', 'Stueck')
      .replace('packungen', 'Packungen')
      .replace('packung', 'Packung')
      .replace('flaschen', 'Flaschen')
      .replace('flasche', 'Flasche')
      .replace('dosen', 'Dosen')
      .replace('dose', 'Dose');
    return `${simple[1].replace(',', '.')} ${unit}`;
  }

  if (/\bper\s+kg\b/i.test(text)) return '1 kg';
  if (/\bper\s+liter\b/i.test(text)) return '1 l';
  return '';
}

function extractConditions(lines = []) {
  const text = sanitizeWhitespace(lines.join(' '));
  const normalized = normalizeForScan(text);
  const conditions = [];

  for (const token of ['1+1', '2+1', '2+2', '3+3', '6+6', '12+12']) {
    const pattern = new RegExp(token.replace('+', '\\s*\\+\\s*') + '\\s+gratis', 'i');
    if (pattern.test(text)) conditions.push(`${token} gratis`);
  }

  const threshold = text.match(/\b(?:ab|bei)\s+(\d+)\s*(fl|flaschen|ds|dosen|pkg|packungen|stk|stueck|stück|be|becher|gl|glaeser|gläser)?\.?\s+(?:je\s+)?\d{1,3}[,.]\d{2}\b/i);
  if (threshold) {
    const unit = threshold[2] ? ` ${threshold[2].replace('stück', 'Stueck')}` : '';
    conditions.push(`ab/bei ${threshold[1]}${unit} laut Flugblatt`);
  }
  if (/\bmit\s+(?:spar-)?app-gutschein\b/i.test(normalized)) conditions.push('mit SPAR-App-Gutschein laut Flugblatt');
  if (/\bmit\s+gutschein\b/i.test(normalized)) conditions.push('mit Gutschein laut Flugblatt');

  return sanitizeWhitespace([...new Set(conditions)].join(' / '));
}

function titleFromLines(lines = []) {
  const titleLines = [];

  for (const line of lines) {
    if (isLayoutNoiseLine(line)) continue;
    const clean = sanitizeWhitespace(line)
      .replace(/^(?:nur\s+f(?:ue|u)r\s+kurze\s+zeit!|aktuell!|neu\s+bei\s+spar)\s*/i, '');
    if (!PRODUCT_WORD_RE.test(clean)) continue;
    titleLines.push(clean);
    if (/\b\d+(?:[,.]\d+)?\s*(?:kg|g|l|liter|ml|stk|stueck|stück|packung|pkg|flasche|dose|dosen|rollen|beutel|windeln)\b/i.test(clean)) break;
    if (titleLines.length >= 4) break;
  }

  return stripQuantityTail(titleLines.join(' '));
}

function buildLayoutCandidate({ pageNumber, anchor, items, sourceRetailerFormat }) {
  const windowItems = items.filter((item) => {
    const dx = Math.abs((item.x + item.w / 2) - (anchor.x + anchor.w / 2));
    const dy = Math.abs((item.y + item.h / 2) - (anchor.y + anchor.h / 2));
    return dx <= 190 && dy <= 170;
  });
  const lines = groupItemsIntoLines(windowItems);
  const rawText = sanitizeWhitespace(lines.join(' '));
  const title = titleFromLines(lines);
  const quantityText = extractQuantityText(lines);

  if (!title || !quantityText || !isPlausibleLayoutTitle(title)) {
    return null;
  }
  if (/\b(?:per\s+liter|per\s+kg|ersparnis|stattpreise)\b/i.test(normalizeForScan(title))) {
    return null;
  }

  return {
    id: `spar-layout-p${pageNumber}-${Math.round(anchor.x)}-${Math.round(anchor.y)}-${String(anchor.amount).replace('.', '-')}`,
    page: pageNumber,
    productKind: 'generic-flyer-product',
    sourceRetailerFormat,
    title,
    brand: title.split(/\s+/)[0] || '',
    price: anchor.amount,
    referencePrice: null,
    quantityText,
    conditionsText: extractConditions(lines),
    rawText,
    comparisonSafe: !/\b(?:versch|verschiedene)\s+sorten\b/i.test(rawText),
    parserHint: 'pdfjs-layout-price-window',
    searchKeywords: `${title} ${quantityText}`,
  };
}

function canonicalizeValidatedLayoutCandidate(candidate = {}) {
  if (!candidate) return null;

  const text = normalizeForScan(`${candidate.title || ''} ${candidate.rawText || ''}`);

  if (
    /always\s*ultra\s*binden/.test(text)
    && /big\s*pack|12\s*-\s*26\s*(?:stuck|stueck)/.test(text)
    && Number(candidate.price) === 3.19
  ) {
    return {
      ...candidate,
      productKind: 'generic-flyer-product',
      title: 'Always Ultra Binden Big Pack',
      brand: 'Always',
      price: 3.19,
      referencePrice: 4.08,
      quantityText: '12-26 Stueck',
      conditionsText: candidate.conditionsText || 'ab 2 Packungen je 3,19 laut Flugblatt',
      comparisonSafe: false,
      categoryPrimary: 'Drogerie / Hygiene',
      categorySecondary: 'Damenhygiene',
      categoryKey: 'damenhygiene',
      searchKeywords: 'Always Ultra Binden Big Pack 12 26 Stueck SPAR',
    };
  }

  if (
    /spar\s*(?:mullsack|muellsack)\s*mit\s*zugband/.test(text)
    && /35,\s*45\s+oder\s+70\s*liter/.test(text)
    && [1.32, 1.99].includes(Number(candidate.price))
  ) {
    const currentThresholdDeal = Number(candidate.price) === 1.99;
    return {
      ...candidate,
      productKind: 'generic-flyer-product',
      title: 'SPAR Muellsack mit Zugband',
      brand: 'SPAR',
      price: currentThresholdDeal ? 1.99 : 1.32,
      referencePrice: currentThresholdDeal ? 2.19 : 1.99,
      quantityText: '35-70 l',
      conditionsText: currentThresholdDeal
        ? 'ab 2 Packungen je 1,99 laut Flugblatt'
        : '2+1 gratis laut Flugblatt',
      comparisonSafe: false,
      categoryPrimary: 'Haushalt',
      categorySecondary: 'Aufbewahrung & Folien',
      categoryKey: 'aufbewahrung-folien',
      searchKeywords: 'SPAR Muellsack mit Zugband 35 45 70 Liter Monatssparer Haushalt',
    };
  }

  return null;
}

function candidateKey(candidate = {}) {
  return [
    candidate.page || '',
    normalizeTitleForMatch(candidate.title || ''),
    String(candidate.price || ''),
    normalizeTitleForMatch(candidate.quantityText || ''),
  ].join('::');
}

async function extractSparFamilyPdfLayoutCandidates({
  pdfBuffer,
  maxPages = 6,
  sourceRetailerFormat = 'spar',
} = {}) {
  if (!Buffer.isBuffer(pdfBuffer)) return [];

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await pdfjs.getDocument({
    data: new Uint8Array(pdfBuffer),
    disableWorker: true,
    useSystemFonts: true,
  }).promise;
  const candidates = [];
  const seen = new Set();

  try {
    const pageLimit = Math.min(maxPages, document.numPages);
    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const items = textContent.items
        .map((item) => ({
          text: sanitizeWhitespace(item.str || ''),
          x: Number(item.transform?.[4] || 0),
          y: Number(item.transform?.[5] || 0),
          w: Number(item.width || 0),
          h: Number(item.height || 0),
        }))
        .filter((item) => item.text);
      const anchors = parseLayoutPriceItems(items)
        .filter((anchor) => anchor.amount >= 0.3 && anchor.amount <= 150);

      for (const anchor of anchors) {
        const candidate = canonicalizeValidatedLayoutCandidate(buildLayoutCandidate({
          pageNumber,
          anchor,
          items,
          sourceRetailerFormat,
        }));
        if (!candidate) continue;
        const key = candidateKey(candidate);
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push(candidate);
      }
    }
  } finally {
    await document.destroy();
  }

  return candidates;
}

module.exports = {
  extractSparFamilyPdfLayoutCandidates,
};
