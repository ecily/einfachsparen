const { sanitizeWhitespace, normalizeTitleForMatch } = require('./sourceEvidence');

const PRICE_TOKEN_RE = /^(?:\d{1,3}[,.]\d{2})$/;
const PRODUCT_LETTER_RE = /\p{L}/u;
const NOISE_RE = /\b(?:abgabe|aktion|aktionspreise|angebote?\s+gueltig|app-gutschein|bis\s+zu|einzuloesen|ersparnis|facebook|gratis|gutschein|haushaltsmengen|immer\s+billig|instagram|mengenvorteil|monatssparer|noch\s+zusaetzlich|noch\s+zusatzlich|per\s+kg|per\s+liter|prozentaktion|seite|sie\s+sparen|spar-maerkten|stattpreise|verkaufspreise|www\.spar\.at)\b|%-aktion/i;

function normalizeForCardScan(value = '') {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/Ã¤/g, 'ae')
    .replace(/Ã¶/g, 'oe')
    .replace(/Ã¼/g, 'ue')
    .replace(/ÃŸ/g, 'ss')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function numberFromPriceToken(value = '') {
  const amount = Number(String(value || '').replace(/\s+/g, '').replace(',', '.'));
  return Number.isFinite(amount) ? Number(amount.toFixed(2)) : null;
}

function parsePriceAnchors(items = []) {
  const anchors = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const text = sanitizeWhitespace(item.text || '');

    if (PRICE_TOKEN_RE.test(text)) {
      const amount = numberFromPriceToken(text);
      if (amount > 0) {
        anchors.push({ ...item, index, amount, token: text, kind: 'price' });
      }
      continue;
    }

    const euroPart = text.match(/^(\d{1,3})[,.]$/);
    if (!euroPart) continue;

    const cents = items.slice(index + 1, index + 6).find((candidate) => {
      const candidateText = sanitizeWhitespace(candidate.text || '');
      return /^\d{2}$/.test(candidateText)
        && candidate.x >= item.x + item.w - 6
        && candidate.x <= item.x + item.w + 44
        && Math.abs(candidate.y - item.y) <= 30;
    });

    if (!cents) continue;
    const amount = Number(`${euroPart[1]}.${sanitizeWhitespace(cents.text)}`);
    if (Number.isFinite(amount) && amount > 0) {
      anchors.push({
        x: Math.min(item.x, cents.x),
        y: Math.min(item.y, cents.y),
        w: Math.max(item.x + item.w, cents.x + cents.w) - Math.min(item.x, cents.x),
        h: Math.max(item.y + item.h, cents.y + cents.h) - Math.min(item.y, cents.y),
        index,
        amount: Number(amount.toFixed(2)),
        token: `${euroPart[1]},${sanitizeWhitespace(cents.text)}`,
        kind: 'split-price',
      });
    }
  }

  return anchors.filter((anchor) => anchor.amount >= 0.2 && anchor.amount <= 250);
}

function verticalDistance(left, right) {
  return Math.abs((left.y + left.h / 2) - (right.y + right.h / 2));
}

function horizontalDistance(left, right) {
  return Math.abs((left.x + left.w / 2) - (right.x + right.w / 2));
}

function itemsInZone(items = [], anchor = {}, options = {}) {
  const xRadius = options.xRadius ?? 210;
  const yAbove = options.yAbove ?? 165;
  const yBelow = options.yBelow ?? 70;
  const anchorCx = anchor.x + anchor.w / 2;
  const anchorCy = anchor.y + anchor.h / 2;

  return items.filter((item) => {
    const cx = item.x + item.w / 2;
    const cy = item.y + item.h / 2;
    return Math.abs(cx - anchorCx) <= xRadius
      && cy <= anchorCy + yBelow
      && cy >= anchorCy - yAbove;
  });
}

function groupItemsIntoRows(items = []) {
  const sorted = [...items].sort((a, b) => {
    if (Math.abs(b.y - a.y) > 4) return b.y - a.y;
    return a.x - b.x;
  });
  const rows = [];

  for (const item of sorted) {
    const row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= 4);
    if (row) {
      row.items.push(item);
      row.y = (row.y + item.y) / 2;
    } else {
      rows.push({ y: item.y, items: [item] });
    }
  }

  return rows
    .map((row) => ({
      y: row.y,
      text: sanitizeWhitespace(row.items.sort((a, b) => a.x - b.x).map((item) => item.text).join(' ')),
    }))
    .filter((row) => row.text);
}

function isTitleNoise(line = '') {
  const normalized = normalizeForCardScan(line);
  return !normalized
    || normalized.length < 3
    || PRICE_TOKEN_RE.test(sanitizeWhitespace(line))
    || /\b\d{1,3}[,.]\d{2}\b/.test(line)
    || /^[-+]?[\d\s.,%]+$/.test(normalized)
    || /^(?:ab|bei|je|per|pkg|stueck|stk|statt|von|bis|\d)\b/.test(normalized)
    || NOISE_RE.test(normalized);
}

function cleanTitleLine(line = '') {
  return sanitizeWhitespace(line)
    .replace(/^(?:aktion!|nur\s+f(?:ue|u)r\s+kurze\s+zeit!|neu\s+bei\s+spar)\s*/i, '')
    .replace(/\b\d+(?:[,.]\d+)?\s*(?:kg|g|l|liter|ml|stk|stueck|pkg|packungen?|flaschen?|dosen?)\b.*$/i, '')
    .replace(/[,.]\s*$/, '');
}

function pickTitleCandidate(rows = []) {
  const titleLines = [];

  for (const row of rows) {
    if (isTitleNoise(row.text)) continue;
    const line = cleanTitleLine(row.text);
    if (!PRODUCT_LETTER_RE.test(line)) continue;
    titleLines.push(line);
    if (titleLines.length >= 3) break;
  }

  const title = sanitizeWhitespace(titleLines.join(' '));
  const normalized = normalizeForCardScan(title);
  if (title.length < 8 || title.length > 120) return '';
  if (!PRODUCT_LETTER_RE.test(title)) return '';
  if (NOISE_RE.test(normalized)) return '';
  if (/\b\d{1,3}[,.]\d{2}\b/.test(title)) return '';
  if (/\b(?:per\s+kg|per\s+liter|ab\s+\d+|statt|gratis|gutschein|mengenvorteil)\b/i.test(normalized)) return '';
  return title;
}

function pickQuantityCandidate(rows = []) {
  const text = rows.map((row) => row.text).join(' ');
  const multi = text.match(/\b(\d{1,2})(?:er|\s*x)\s*[-\s]?(?:tray|kiste|packung|pkg)\b[\s\S]{0,80}\b(\d+(?:[,.]\d+)?)\s*(liter|l|ml|kg|g)\b/i);
  if (multi) return `${multi[1]} x ${multi[2].replace(',', '.')} ${multi[3].toLowerCase().replace('liter', 'l')}`;

  const simple = text.match(/\b(\d+(?:[,.]\d+)?)\s*(kg|g|liter|l|ml|stk|stueck|packungen?|pkg|flaschen?|dosen?)\b/i);
  if (simple) return `${simple[1].replace(',', '.')} ${simple[2].toLowerCase().replace('liter', 'l').replace('stueck', 'Stueck')}`;

  if (/\bper\s+kg\b/i.test(text)) return '1 kg';
  if (/\bper\s+liter\b/i.test(text)) return '1 l';
  return '';
}

function pickConditionCandidate(rows = []) {
  const text = rows.map((row) => row.text).join(' ');
  const conditions = [];

  for (const token of ['1+1', '2+1', '2+2', '3+3', '6+6', '12+12']) {
    const pattern = new RegExp(token.replace('+', '\\s*\\+\\s*') + '\\s+gratis', 'i');
    if (pattern.test(text)) conditions.push(`${token} gratis`);
  }

  const threshold = text.match(/\b(?:ab|bei)\s+(\d+)\s*(fl|flaschen|ds|dosen|pkg|packungen|stk|stueck)?\.?\s+(?:je\s+)?\d{1,3}[,.]\d{2}\b/i);
  if (threshold) conditions.push(`ab/bei ${threshold[1]}${threshold[2] ? ` ${threshold[2]}` : ''}`);
  if (/\bapp-gutschein\b/i.test(text)) conditions.push('App-Gutschein');
  if (/\bgutschein\b/i.test(text)) conditions.push('Gutschein');

  return sanitizeWhitespace([...new Set(conditions)].join(' / '));
}

function countPriceTokens(text = '') {
  return [...String(text || '').matchAll(/\b\d{1,3}[,.]\d{2}\b/g)].length;
}

function countQuantityTokens(text = '') {
  return [...String(text || '').matchAll(/\b\d+(?:[,.]\d+)?\s*(?:kg|g|l|liter|ml|stk|stueck|pkg|packungen?|flaschen?|dosen?|becher|gl(?:as|a?ser)?)\b/ig)].length;
}

function countCompetingAnchors(anchors = [], anchor = {}) {
  return anchors.filter((candidate) => candidate !== anchor
    && horizontalDistance(candidate, anchor) <= 170
    && verticalDistance(candidate, anchor) <= 95).length;
}

function countNearbyImages(images = [], anchor = {}) {
  const anchorCx = anchor.x + anchor.w / 2;
  const anchorCy = anchor.y + anchor.h / 2;
  return images.filter((image) => {
    const cx = image.x + image.w / 2;
    const cy = image.y + image.h / 2;
    return Math.abs(cx - anchorCx) <= 230 && Math.abs(cy - anchorCy) <= 190;
  }).length;
}

function buildOfferCardDiagnostics({
  pageNumber,
  textItems = [],
  imageItems = [],
  sourceKey = '',
  sourceRetailerFormat = '',
} = {}) {
  const items = textItems
    .map((item) => ({
      text: sanitizeWhitespace(item.text || item.str || ''),
      x: Number(item.x ?? item.transform?.[4] ?? 0),
      y: Number(item.y ?? item.transform?.[5] ?? 0),
      w: Number(item.w ?? item.width ?? 0),
      h: Number(item.h ?? item.height ?? 0),
    }))
    .filter((item) => item.text);
  const anchors = parsePriceAnchors(items);

  return anchors.map((anchor) => {
    const zoneItems = itemsInZone(items, anchor);
    const rows = groupItemsIntoRows(zoneItems);
    const title = pickTitleCandidate(rows);
    const quantity = pickQuantityCandidate(rows);
    const condition = pickConditionCandidate(rows);
    const rawZoneText = sanitizeWhitespace(rows.map((row) => row.text).join(' '));
    const competingPriceAnchors = countCompetingAnchors(anchors, anchor);
    const nearbyImageCandidates = countNearbyImages(imageItems, anchor);
    const priceTokenCount = countPriceTokens(rawZoneText);
    const quantityTokenCount = countQuantityTokens(rawZoneText);
    const rejectionReasons = [];

    if (!title) rejectionReasons.push('title-missing');
    if (!quantity) rejectionReasons.push('quantity-missing');
    if (competingPriceAnchors > 1) rejectionReasons.push('neighbor-conflict');
    if (priceTokenCount > 3) rejectionReasons.push('multi-price-zone');
    if (quantityTokenCount > 4) rejectionReasons.push('multi-quantity-zone');
    if (title && NOISE_RE.test(normalizeForCardScan(title))) rejectionReasons.push('product-unclear');
    if (title && /\b\d{1,3}[,.]\d{2}\b/.test(title)) rejectionReasons.push('price-in-title');

    const confidence = Number((
      0.18
      + (title ? 0.34 : 0)
      + (quantity ? 0.22 : 0)
      + (condition ? 0.06 : 0)
      + (competingPriceAnchors === 0 ? 0.16 : competingPriceAnchors === 1 ? 0.04 : -0.12)
      + (nearbyImageCandidates === 1 ? 0.04 : 0)
    ).toFixed(2));
    const publishable = rejectionReasons.length === 0 && confidence >= 0.92;

    return {
      sourceKey,
      sourceRetailerFormat,
      page: pageNumber,
      anchor: {
        x: anchor.x,
        y: anchor.y,
      amount: anchor.amount,
      token: anchor.token,
      kind: anchor.kind,
      },
      visiblePriceAnchors: anchors.length,
      title,
      quantity,
      condition,
      rawZoneText: rawZoneText.slice(0, 900),
      competingPriceAnchors,
      neighborConflict: competingPriceAnchors > 1,
      priceTokenCount,
      quantityTokenCount,
      nearbyImageCandidates,
      imagePublishable: false,
      imagePublishReason: nearbyImageCandidates === 1
        ? 'nearby-image-exists-but-crop-hosting-and-product-boundary-not-verified'
        : 'no-unique-nearby-image',
      confidence,
      publishable,
      rejectionReasons,
      decision: publishable ? 'diagnostic-publishable-candidate' : `reject:${rejectionReasons.join(',') || 'low-confidence'}`,
    };
  });
}

module.exports = {
  buildOfferCardDiagnostics,
  groupItemsIntoRows,
  itemsInZone,
  normalizeForCardScan,
  parsePriceAnchors,
  pickConditionCandidate,
  pickQuantityCandidate,
  pickTitleCandidate,
};
