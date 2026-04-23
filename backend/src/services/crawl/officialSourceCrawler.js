const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('node:crypto');
const Source = require('../../models/Source');
const CrawlJob = require('../../models/CrawlJob');
const Offer = require('../../models/Offer');
const {
  sanitizeWhitespace,
  normalizeTitleForMatch,
  buildSourceEvidence,
} = require('./sourceEvidence');
const { clearRawDocumentsForSource, createCompactRawDocument } = require('./rawDocumentStorage');
const {
  determineOfferCategory,
  determineOfferSubcategory,
  buildInclusiveScopeDecision,
} = require('./categoryClassifier');
const { applyManualCategoryOverridesToOfferSync } = require('../quality/manualCategoryOverrideService');

function toAbsoluteUrl(href, baseUrl) {
  try {
    return new URL(href, baseUrl).toString();
  } catch (error) {
    return '';
  }
}

function createHash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function parseNumericAmount(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const numeric = Number(
    String(value)
      .replace(/[^\d,.-]+/g, '')
      .replace(/\.(?=\d{3}(?:\D|$))/g, '')
      .replace(',', '.')
  );

  return Number.isFinite(numeric) ? numeric : null;
}

function extractRelevantLinks({ html, baseUrl, retailerKey }) {
  const $ = cheerio.load(html);
  const links = [];
  const seen = new Set();

  function pushLink(url, label, type) {
    const normalizedUrl = sanitizeWhitespace(url);

    if (!normalizedUrl || seen.has(normalizedUrl)) {
      return;
    }

    seen.add(normalizedUrl);
    links.push({
      url: normalizedUrl,
      label: sanitizeWhitespace(label) || normalizedUrl,
      type,
    });
  }

  $('a[href]').each((index, element) => {
    const href = $(element).attr('href');
    const text = sanitizeWhitespace($(element).text());
    const absoluteUrl = toAbsoluteUrl(href, baseUrl);
    const haystack = `${absoluteUrl} ${text}`.toLowerCase();

    if (!absoluteUrl.startsWith('http')) {
      return;
    }

    if (/\.(pdf)(\?|$)/i.test(absoluteUrl)) {
      pushLink(absoluteUrl, text, 'pdf');
      return;
    }

    if (/(flugblatt|aktionen|angebote|prospekt|broschuere|download|blaettern|blättern)/i.test(haystack)) {
      pushLink(absoluteUrl, text, 'page');
    }
  });

  for (const match of html.matchAll(/https?:\/\/[^\s"'<>]+\.pdf(?:\?[^\s"'<>]+)?/gi)) {
    pushLink(match[0], match[0], 'pdf');
  }

  if (retailerKey === 'spar') {
    const regionalFirst = links.filter((item) => /steiermark|graz/i.test(`${item.url} ${item.label}`));
    const fallback = links.filter((item) => !regionalFirst.includes(item));
    return [...regionalFirst, ...fallback].slice(0, 25);
  }

  return links.slice(0, 25);
}

function parseDateFromText(value) {
  const match = String(value || '').match(/(\d{2})\.(\d{2})\.(\d{4})/);

  if (!match) {
    return null;
  }

  const [day, month, year] = match.slice(1).map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function parseHoferDateFromUrl(url) {
  const match = String(url || '').match(/\/d\.(\d{2})-(\d{2})-(\d{4})\.html/i);

  if (!match) {
    return null;
  }

  const [day, month, year] = match.slice(1).map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function addDays(date, days) {
  if (!date) {
    return null;
  }

  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function buildOfferStatus(validFrom, validTo, snapshotCurrent = false) {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  let status = 'unknown';

  if (snapshotCurrent) {
    status = 'active';
  } else if (validFrom && validFrom > now) {
    status = 'upcoming';
  } else if (validTo && validTo < now) {
    status = 'expired';
  } else if ((validFrom || validTo) && (!validFrom || validFrom <= now) && (!validTo || validTo >= now)) {
    status = 'active';
  }

  return {
    status,
    isActiveNow: status === 'active',
    isActiveToday:
      status === 'active'
      || ((!validFrom || validFrom <= endOfToday) && (!validTo || validTo >= startOfToday)),
  };
}

function parseDateWithWeekday(value) {
  const match = String(value || '').match(/(\d{2})\.(\d{2})\.(\d{4})/);

  if (!match) {
    return null;
  }

  const [day, month, year] = match.slice(1).map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function normalizeUnitFromText(value) {
  const normalized = normalizeTitleForMatch(value);

  if (/stuck|stueck|stk/.test(normalized)) {
    return 'Stk';
  }

  if (/(kilogramm|kg)/.test(normalized)) {
    return 'kg';
  }

  if (/(liter| l )/.test(` ${normalized} `)) {
    return 'l';
  }

  if (/(milliliter| ml )/.test(` ${normalized} `)) {
    return 'ml';
  }

  if (/(gramm| g )/.test(` ${normalized} `)) {
    return 'g';
  }

  return '';
}

function buildOfficialNormalizedUnitPrice({ priceAmount, quantityText }) {
  const normalizedQuantityText = normalizeTitleForMatch(quantityText);
  const directPerMatch = normalizedQuantityText.match(/per\s+(stuck|stueck|stk|kg|kilogramm|l|liter|ml|milliliter|g|gramm)/);

  if (directPerMatch) {
    const unit = normalizeUnitFromText(directPerMatch[1]);

    if (unit === 'Stk') {
      return {
        amount: priceAmount,
        unit,
        comparable: true,
        confidence: 0.84,
      };
    }

    if (['kg', 'l'].includes(unit)) {
      return {
        amount: priceAmount,
        unit,
        comparable: true,
        confidence: 0.8,
      };
    }
  }

  const quantityMatch = normalizedQuantityText.match(/(\d+(?:[.,]\d+)?)\s*(kg|kilogramm|g|gramm|l|liter|ml|milliliter)/);

  if (!quantityMatch) {
    return {
      amount: null,
      unit: '',
      comparable: false,
      confidence: 0,
    };
  }

  let quantity = Number(quantityMatch[1].replace(',', '.'));
  let unit = normalizeUnitFromText(quantityMatch[2]);

  if (!quantity || !unit) {
    return {
      amount: null,
      unit: '',
      comparable: false,
      confidence: 0,
    };
  }

  if (unit === 'g') {
    quantity /= 1000;
    unit = 'kg';
  }

  if (unit === 'ml') {
    quantity /= 1000;
    unit = 'l';
  }

  if (quantity <= 0 || !['kg', 'l'].includes(unit)) {
    return {
      amount: null,
      unit: '',
      comparable: false,
      confidence: 0,
    };
  }

  return {
    amount: Number((priceAmount / quantity).toFixed(2)),
    unit,
    comparable: true,
    confidence: 0.86,
  };
}

function buildUnitPriceFromLabel(label, currentPrice) {
  const text = sanitizeWhitespace(label);
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|l|liter|ml|stuck|stueck|stk|waschgang)\s+([\d,.]+)/i);

  if (!match) {
    return buildOfficialNormalizedUnitPrice({
      priceAmount: currentPrice,
      quantityText: text,
    });
  }

  const amount = parseNumericAmount(match[3]);
  const unit = normalizeUnitFromText(match[2]);
  const comparableUnit = unit === 'g' ? 'kg' : unit === 'ml' ? 'l' : unit;

  return {
    amount,
    unit: comparableUnit || unit,
    comparable: Boolean(amount && ['kg', 'l', 'Stk'].includes(comparableUnit || unit)),
    confidence: amount ? 0.9 : 0,
  };
}

function extractImageUrl(card) {
  return (
    card.find('.at-product-images_img').attr('data-src')
    || card.find('.at-product-images_img').attr('src')
    || card.find('img').attr('data-src')
    || card.find('img').attr('src')
    || ''
  );
}

function decodeHtmlEntities(value) {
  return sanitizeWhitespace(cheerio.load(`<span>${String(value || '')}</span>`)('span').text());
}

function extractLidlFlyerIdentifiers(html) {
  const $ = cheerio.load(html);
  const identifiers = new Set();

  $('a[href*="/l/de/flugblatt/"]').each((index, element) => {
    const href = sanitizeWhitespace($(element).attr('href'));
    const match = href.match(/\/l\/de\/flugblatt\/([^/]+)\/ar\/\d+/i);

    if (match?.[1]) {
      identifiers.add(match[1]);
    }
  });

  return [...identifiers];
}

function parseLidlFlyerDate(value) {
  const match = String(value || '').match(/(\d{4})-(\d{2})-(\d{2})/);

  if (!match) {
    return null;
  }

  const [, year, month, day] = match.map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function buildLidlNormalizedUnitPrice(description, currentPrice) {
  const text = normalizeTitleForMatch(decodeHtmlEntities(description));
  const perUnitMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(eur|euro)?\s*\/\s*(kg|kilogramm|l|liter|stk|stueck|stuck)/i);

  if (perUnitMatch) {
    return {
      amount: parseNumericAmount(perUnitMatch[1]),
      unit: normalizeUnitFromText(perUnitMatch[3]),
      comparable: Boolean(parseNumericAmount(perUnitMatch[1])),
      confidence: 0.9,
    };
  }

  return buildOfficialNormalizedUnitPrice({
    priceAmount: currentPrice,
    quantityText: decodeHtmlEntities(description),
  });
}

function extractLidlQuantityText(description) {
  const text = decodeHtmlEntities(description);
  const quantityMatch = text.match(
    /(\d+(?:[.,]\d+)?\s*(?:kg|g|l|ml|cl|stk|stueck|stuck)|\d+\s*x\s*\d+(?:[.,]\d+)?\s*(?:kg|g|l|ml|cl))/i
  );

  return sanitizeWhitespace(quantityMatch?.[1] || '');
}

function normalizeLidlProductToOffer({
  product,
  flyer,
  source,
  crawlJobId,
  region,
}) {
  const currentPrice = parseNumericAmount(product?.price);
  const title = sanitizeWhitespace(product?.title);
  const brand = sanitizeWhitespace(product?.brand);
  const description = decodeHtmlEntities(product?.description);
  const quantityText = extractLidlQuantityText(description);
  const normalizedUnitPrice = buildLidlNormalizedUnitPrice(description, currentPrice);
  const categoryPrimary = determineOfferCategory({
    title: sanitizeWhitespace(`${brand} ${title}`),
    contextText: [description, product?.wonCategoryPrimary, product?.categoryPrimary].filter(Boolean).join(' '),
    sourceCategory: product?.wonCategoryPrimary || product?.categoryPrimary || '',
  });
  const validFrom = parseLidlFlyerDate(flyer?.offerStartDate || flyer?.startDate);
  const validTo = parseLidlFlyerDate(flyer?.offerEndDate || flyer?.endDate);
  const statusInfo = buildOfferStatus(validFrom, validTo);
  const customerProgramRequired = /lidl plus/i.test(description);
  const issues = [];

  if (!title || !currentPrice) {
    return null;
  }

  if (!normalizedUnitPrice.comparable) {
    issues.push('Vergleichseinheit unsicher oder nicht ableitbar');
  }

  if (!validFrom || !validTo) {
    issues.push('Gueltigkeitszeitraum unvollstaendig');
  }

  if (customerProgramRequired) {
    issues.push('Angebot erfordert Kundenprogramm oder App');
  }

  return applyManualCategoryOverridesToOfferSync({
    crawlJobId,
    sourceId: source._id,
    retailerKey: source.retailerKey,
    retailerName: source.retailerName,
    region,
    title,
    brand,
    categoryPrimary,
    categorySecondary: determineOfferSubcategory({
      primaryCategory: categoryPrimary,
      sourceCategory: product?.wonCategoryPrimary || product?.categoryPrimary || '',
      fallbackLabel: categoryPrimary,
      title,
      contextText: description,
    }),
    comparisonSignature: normalizeTitleForMatch(`${brand} ${title}`).split(' ').slice(0, 8).join('-'),
    comparisonQuantityKey: quantityText ? normalizeTitleForMatch(quantityText).replace(/[^a-z0-9]+/g, '-') : '',
    comparisonCategoryKey: normalizeTitleForMatch(product?.wonCategoryPrimary || categoryPrimary).replace(/[^a-z0-9]+/g, '-'),
    description,
    sourceUrl: product?.url || source.sourceUrl,
    imageUrl: product?.image || '',
    supportingSources: [
      buildSourceEvidence({
        source,
        observedUrl: product?.url || flyer?.flyerUrlAbsolute || source.sourceUrl,
        matchType: 'primary',
      }),
    ],
    validFrom,
    validTo,
    status: statusInfo.status,
    isActiveNow: statusInfo.isActiveNow,
    isActiveToday: statusInfo.isActiveToday,
    benefitType: customerProgramRequired ? 'conditional-price' : 'price-cut',
    conditionsText: customerProgramRequired ? 'Nur gueltig mit Lidl Plus' : '',
    customerProgramRequired,
    availabilityScope: region || 'Grossraum Graz',
    priceCurrent: {
      amount: currentPrice,
      currency: 'EUR',
      originalText: `${currentPrice.toFixed(2)} EUR`,
    },
    priceReference: {
      amount: null,
      currency: 'EUR',
      originalText: '',
    },
    quantityText,
    normalizedUnitPrice,
    quality: {
      completenessScore: [currentPrice, validFrom, validTo, categoryPrimary].filter(Boolean).length / 4,
      parsingConfidence: normalizedUnitPrice.comparable ? 0.88 : 0.76,
      comparisonSafe: normalizedUnitPrice.comparable,
      issues,
    },
    rawFacts: {
      sourceType: 'lidl-official-flyer-api',
      validityText: [flyer?.offerStartDate, flyer?.offerEndDate].filter(Boolean).join(' - '),
      infoText: sanitizeWhitespace([product?.categoryPrimary, product?.wonCategoryPrimary].filter(Boolean).join(' / ')),
      productId: sanitizeWhitespace(product?.productId),
      snapshotCurrent: false,
    },
    adminReview: {
      status: issues.length > 0 ? 'pending' : 'reviewed',
      note: '',
      feedbackDigest: '',
    },
    scope: buildInclusiveScopeDecision(),
  }).offer;
}

async function fetchLidlFlyerByIdentifier(identifier) {
  const response = await axios.get('https://endpoints.leaflets.schwarz/v4/flyer', {
    timeout: 30000,
    params: {
      flyer_identifier: identifier,
      region_id: 0,
    },
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
      Accept: 'application/json,text/plain,*/*',
      'Accept-Language': 'de-AT,de;q=0.9,en;q=0.8',
    },
  });

  return response.data?.flyer || null;
}

function parsePennyOffersFromHtml({ html, source, crawlJobId, region, pageUrl }) {
  const $ = cheerio.load(html);
  const offers = [];

  $('a[href*="/produkte/"]').each((index, element) => {
    const card = $(element).closest('.ws-product-tile, li, article, div');
    const titleLine = sanitizeWhitespace(card.find('[data-test="product-title"]').first().text());
    const [rawTitle, rawBrand] = titleLine.split('•').map((value) => sanitizeWhitespace(value));
    const title = rawTitle || sanitizeWhitespace($(element).text());
    const brand = rawBrand || '';
    const quantityText = sanitizeWhitespace(
      card.find('[data-test="product-information-piece-description"]').first().text()
    );
    const validityNodes = card.find('[data-test="product-price-validity"] div');
    const validFrom = parseDateWithWeekday(sanitizeWhitespace(validityNodes.eq(0).text()));
    const validTo = parseDateWithWeekday(sanitizeWhitespace(validityNodes.eq(1).text()));
    const currentPrice = parseNumericAmount(card.find('[data-test="product-price-type-value"]').first().text());
    const unitPriceLabel = sanitizeWhitespace(card.find('[data-test="product-price-type-label"]').first().text());
    const normalizedUnitPrice = buildUnitPriceFromLabel(unitPriceLabel, currentPrice);
    const statusInfo = buildOfferStatus(validFrom, validTo);
    const categoryPrimary = determineOfferCategory({
      title,
      contextText: [brand, quantityText, unitPriceLabel].filter(Boolean).join(' '),
    });
    const issues = [];

    if (!title || !currentPrice) {
      return;
    }

    if (!normalizedUnitPrice.comparable) {
      issues.push('Vergleichseinheit unsicher oder nicht ableitbar');
    }

    if (!validFrom || !validTo) {
      issues.push('Gueltigkeitszeitraum unvollstaendig');
    }

    offers.push(applyManualCategoryOverridesToOfferSync({
      crawlJobId,
      sourceId: source._id,
      retailerKey: source.retailerKey,
      retailerName: source.retailerName,
      region,
      title,
      brand,
      categoryPrimary,
      categorySecondary: determineOfferSubcategory({
        primaryCategory: categoryPrimary,
        fallbackLabel: categoryPrimary,
        title,
        contextText: [brand, quantityText, unitPriceLabel].filter(Boolean).join(' '),
      }),
      comparisonSignature: normalizeTitleForMatch(`${brand} ${title}`).split(' ').slice(0, 8).join('-'),
      comparisonQuantityKey: quantityText ? normalizeTitleForMatch(quantityText).replace(/[^a-z0-9]+/g, '-') : '',
      comparisonCategoryKey: normalizeTitleForMatch(categoryPrimary).replace(/[^a-z0-9]+/g, '-'),
      description: '',
      sourceUrl: toAbsoluteUrl($(element).attr('href'), pageUrl) || pageUrl,
      imageUrl: sanitizeWhitespace(card.find('img').first().attr('src') || ''),
      supportingSources: [
        buildSourceEvidence({
          source,
          observedUrl: toAbsoluteUrl($(element).attr('href'), pageUrl) || pageUrl,
          matchType: 'primary',
        }),
      ],
      validFrom,
      validTo,
      status: statusInfo.status,
      isActiveNow: statusInfo.isActiveNow,
      isActiveToday: statusInfo.isActiveToday,
      benefitType: 'unknown',
      conditionsText: '',
      customerProgramRequired: false,
      availabilityScope: region || 'Grossraum Graz',
      priceCurrent: {
        amount: currentPrice,
        currency: 'EUR',
        originalText: `${currentPrice.toFixed(2)} EUR`,
      },
      priceReference: {
        amount: null,
        currency: 'EUR',
        originalText: '',
      },
      quantityText,
      normalizedUnitPrice,
      quality: {
        completenessScore: [currentPrice, validFrom, validTo, categoryPrimary].filter(Boolean).length / 4,
        parsingConfidence: normalizedUnitPrice.comparable ? 0.9 : 0.78,
        comparisonSafe: normalizedUnitPrice.comparable,
        issues,
      },
      rawFacts: {
        sourceType: 'penny-official-html',
        validityText: sanitizeWhitespace(card.find('[data-test="product-price-validity"]').text()),
        infoText: unitPriceLabel,
        snapshotCurrent: false,
      },
      adminReview: {
        status: issues.length > 0 ? 'pending' : 'reviewed',
        note: '',
        feedbackDigest: '',
      },
      scope: buildInclusiveScopeDecision(),
    }).offer);
  });

  return offers;
}

function parseBipaTilePriceInfo(card) {
  const textNodes = card.find('p').map((index, element) => sanitizeWhitespace(card.find('p').eq(index).text())).get();
  const priceText = textNodes.find((value) => value.startsWith('€'));
  const unitPriceText = textNodes.find((value) => /\d+(?:[.,]\d+)?\s*(kg|l|Stk|waschgang|100 g|100 ml)/i.test(value));

  return {
    currentPrice: parseNumericAmount(priceText),
    priceText,
    unitPriceText: unitPriceText || '',
  };
}

function extractBipaValidityDate(html) {
  const dates = [...String(html || '').matchAll(/(?:Gueltig bis|Gültig bis)\s+(\d{2}\.\d{2}\.\d{4})/gi)]
    .map((match) => parseDateWithWeekday(match[1]))
    .filter(Boolean)
    .sort((left, right) => left.getTime() - right.getTime());

  return dates[0] || null;
}

function parseBipaOffersFromHtml({ html, source, crawlJobId, region, pageUrl, validToHint = null }) {
  const $ = cheerio.load(html);
  const offers = [];
  const validFrom = new Date();
  const validTo = validToHint || extractBipaValidityDate(html);
  const statusInfo = buildOfferStatus(validFrom, validTo, true);

  $('a[data-testid^="product-tile-"][href*="/p/"]').each((index, element) => {
    const card = $(element);
    const paragraphs = card.find('p').map((i, el) => sanitizeWhitespace($(el).text())).get().filter(Boolean);
    const brand = paragraphs[0] || '';
    const title = paragraphs[1] || sanitizeWhitespace(card.attr('title') || $(element).text());
    const quantityText = paragraphs[2] || '';
    const { currentPrice, priceText, unitPriceText } = parseBipaTilePriceInfo(card);
    const normalizedUnitPrice = buildUnitPriceFromLabel(unitPriceText, currentPrice);
    const categoryPrimary = determineOfferCategory({
      title,
      contextText: [brand, quantityText, unitPriceText].filter(Boolean).join(' '),
    });
    const issues = [];

    if (!title || !currentPrice) {
      return;
    }

    if (!normalizedUnitPrice.comparable) {
      issues.push('Vergleichseinheit unsicher oder nicht ableitbar');
    }

    if (!validTo) {
      issues.push('Gueltigkeitsende aus offizieller Quelle nicht eindeutig ableitbar');
    }

    offers.push(applyManualCategoryOverridesToOfferSync({
      crawlJobId,
      sourceId: source._id,
      retailerKey: source.retailerKey,
      retailerName: source.retailerName,
      region,
      title,
      brand,
      categoryPrimary,
      categorySecondary: determineOfferSubcategory({
        primaryCategory: categoryPrimary,
        fallbackLabel: categoryPrimary,
        title,
        contextText: [brand, quantityText, unitPriceText].filter(Boolean).join(' '),
      }),
      comparisonSignature: normalizeTitleForMatch(`${brand} ${title}`).split(' ').slice(0, 8).join('-'),
      comparisonQuantityKey: quantityText ? normalizeTitleForMatch(quantityText).replace(/[^a-z0-9]+/g, '-') : '',
      comparisonCategoryKey: normalizeTitleForMatch(categoryPrimary).replace(/[^a-z0-9]+/g, '-'),
      description: '',
      sourceUrl: toAbsoluteUrl(card.attr('href'), pageUrl) || pageUrl,
      imageUrl: sanitizeWhitespace(card.find('img').first().attr('src') || ''),
      supportingSources: [
        buildSourceEvidence({
          source,
          observedUrl: toAbsoluteUrl(card.attr('href'), pageUrl) || pageUrl,
          matchType: pageUrl === source.sourceUrl ? 'primary' : 'official-related',
        }),
      ],
      validFrom,
      validTo,
      status: statusInfo.status,
      isActiveNow: statusInfo.isActiveNow,
      isActiveToday: statusInfo.isActiveToday,
      benefitType: /gratis/i.test([title, unitPriceText].join(' ')) ? 'multi-buy' : 'price-cut',
      conditionsText: '',
      customerProgramRequired: false,
      availabilityScope: region || 'Grossraum Graz',
      priceCurrent: {
        amount: currentPrice,
        currency: 'EUR',
        originalText: priceText || `${currentPrice.toFixed(2)} EUR`,
      },
      priceReference: {
        amount: null,
        currency: 'EUR',
        originalText: '',
      },
      quantityText,
      normalizedUnitPrice,
      quality: {
        completenessScore: [currentPrice, title, categoryPrimary, quantityText].filter(Boolean).length / 4,
        parsingConfidence: normalizedUnitPrice.comparable ? 0.88 : 0.76,
        comparisonSafe: normalizedUnitPrice.comparable,
        issues,
      },
      rawFacts: {
        sourceType: 'bipa-official-html',
        validityText: validTo ? `bis ${validTo.toISOString().slice(0, 10)}` : '',
        infoText: unitPriceText,
        snapshotCurrent: true,
      },
      adminReview: {
        status: issues.length > 0 ? 'pending' : 'reviewed',
        note: '',
        feedbackDigest: '',
      },
      scope: buildInclusiveScopeDecision(),
    }).offer);
  });

  return offers;
}

function collectBipaPromotionLinks(html, baseUrl) {
  const $ = cheerio.load(html);
  const seen = new Set();
  const links = [];

  $('a[href]').each((index, element) => {
    const href = $(element).attr('href');
    const text = sanitizeWhitespace($(element).text());
    const absoluteUrl = toAbsoluteUrl(href, baseUrl);

    if (!absoluteUrl || seen.has(absoluteUrl)) {
      return;
    }

    if (!/bipa\.at/i.test(absoluteUrl)) {
      return;
    }

    if (/\/cp\/aktionen|\/cp\/onlineonly|prefn0=pricebadges|\/c\//i.test(absoluteUrl)) {
      seen.add(absoluteUrl);
      links.push({
        url: absoluteUrl,
        label: text || absoluteUrl,
      });
    }
  });

  return links.slice(0, 10);
}

function parseHoferOffersFromPage({
  html,
  pageUrl,
  source,
  crawlJobId,
  region,
  pageDate,
  nextPageDate,
}) {
  const $ = cheerio.load(html);
  const cards = $('.plp_product');
  const offers = [];

  cards.each((index, element) => {
    const card = $(element);
    const title = sanitizeWhitespace(card.find('.product-title').text());
    const currentPrice = parseNumericAmount(card.find('.at-product-price_lbl').text());
    const oldPrice = parseNumericAmount(card.find('.price_before').text());
    const additionalInfo = sanitizeWhitespace(card.find('.additional-product-info').text());
    const cardText = sanitizeWhitespace(card.text());
    const validFrom = parseDateFromText(cardText) || pageDate;
    const validTo = validFrom && nextPageDate ? addDays(nextPageDate, -1) : null;
    const quantityText = additionalInfo || '';
    const normalizedUnitPrice = buildOfficialNormalizedUnitPrice({
      priceAmount: currentPrice,
      quantityText,
    });
    const brandAndTitle = title;
    const categoryPrimary = determineOfferCategory({
      title: brandAndTitle,
      contextText: additionalInfo,
    });
    const scopeDecision = buildInclusiveScopeDecision();
    const issues = [];

    if (!title || !currentPrice) {
      return;
    }

    if (!normalizedUnitPrice.comparable) {
      issues.push('Vergleichseinheit unsicher oder nicht ableitbar');
    }

    if (!validTo) {
      issues.push('Gueltigkeitsende aus offizieller Quelle nicht eindeutig ableitbar');
    }

    offers.push(applyManualCategoryOverridesToOfferSync({
      crawlJobId,
      sourceId: source._id,
      retailerKey: source.retailerKey,
      retailerName: source.retailerName,
      region,
      title,
      brand: '',
      categoryPrimary,
      categorySecondary: determineOfferSubcategory({
        primaryCategory: categoryPrimary,
        fallbackLabel: categoryPrimary,
        title,
        contextText: additionalInfo,
      }),
      comparisonSignature: normalizeTitleForMatch(title).split(' ').slice(0, 8).join('-'),
      comparisonQuantityKey: quantityText ? normalizeTitleForMatch(quantityText).replace(/[^a-z0-9]+/g, '-') : '',
      comparisonCategoryKey: normalizeTitleForMatch(categoryPrimary).replace(/[^a-z0-9]+/g, '-'),
      description: '',
      sourceUrl: pageUrl,
      imageUrl: extractImageUrl(card),
      supportingSources: [
        buildSourceEvidence({
          source,
          observedUrl: pageUrl,
          matchType: 'primary',
        }),
      ],
      validFrom,
      validTo,
      benefitType: oldPrice && oldPrice > currentPrice ? 'price-cut' : 'unknown',
      conditionsText: '',
      customerProgramRequired: false,
      availabilityScope: region || 'Grossraum Graz',
      priceCurrent: {
        amount: currentPrice,
        currency: 'EUR',
        originalText: `${currentPrice.toFixed(2)} EUR`,
      },
      priceReference: {
        amount: oldPrice,
        currency: 'EUR',
        originalText: oldPrice ? `${oldPrice.toFixed(2)} EUR` : '',
      },
      quantityText,
      normalizedUnitPrice,
      quality: {
        completenessScore: [currentPrice, validFrom, categoryPrimary].filter(Boolean).length / 3,
        parsingConfidence: normalizedUnitPrice.comparable ? 0.84 : 0.72,
        comparisonSafe: normalizedUnitPrice.comparable,
        issues,
      },
      rawFacts: {
        sourceType: 'hofer-official-html',
        additionalInfo,
        pageUrl,
      },
      adminReview: {
        status: issues.length > 0 ? 'pending' : 'reviewed',
        note: '',
        feedbackDigest: '',
      },
      scope: scopeDecision,
    }).offer);
  });

  return offers;
}

async function fetchHtml(url) {
  const response = await axios.get(url, {
    timeout: 30000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/json',
      'Accept-Language': 'de-AT,de;q=0.9,en;q=0.8',
    },
  });

  return {
    response,
    html: String(response.data),
    canonicalUrl: response.request?.res?.responseUrl || url,
  };
}

function buildBillaPrice(hit) {
  const currentPrice = hit?.price?.regular?.value ? Number((hit.price.regular.value / 100).toFixed(2)) : null;
  const referencePrice = hit?.price?.crossed ? Number((hit.price.crossed / 100).toFixed(2)) : null;

  return {
    currentPrice,
    referencePrice,
    unit: normalizeUnitFromText(hit?.volumeLabelShort || hit?.price?.baseUnitShort || hit?.price?.baseUnitLong),
  };
}

function buildBillaNormalizedUnitPrice(hit, currentPrice) {
  const quantity = parseNumericAmount(hit?.amount);
  let unit = normalizeUnitFromText(hit?.volumeLabelShort || hit?.price?.baseUnitShort || hit?.price?.baseUnitLong);

  if (!quantity || !unit || !currentPrice) {
    return {
      amount: null,
      unit: '',
      comparable: false,
      confidence: 0,
    };
  }

  let comparableQuantity = quantity;

  if (unit === 'g') {
    comparableQuantity = quantity / 1000;
    unit = 'kg';
  }

  if (unit === 'ml') {
    comparableQuantity = quantity / 1000;
    unit = 'l';
  }

  if (!['kg', 'l', 'Stk'].includes(unit) || comparableQuantity <= 0) {
    return {
      amount: null,
      unit: '',
      comparable: false,
      confidence: 0,
    };
  }

  return {
    amount: Number((currentPrice / comparableQuantity).toFixed(2)),
    unit,
    comparable: true,
    confidence: 0.88,
  };
}

async function fetchBillaAlgoliaPromotionHits() {
  const endpoint = 'https://1L8FZ3LLKJ-dsn.algolia.net/1/indexes/prod_product_search/query';
  const headers = {
    'X-Algolia-API-Key': '4872917f97ea7474bd5a4efd496e16fb',
    'X-Algolia-Application-Id': '1L8FZ3LLKJ',
    'Content-Type': 'application/json',
  };
  const hits = [];
  const hitsPerPage = 500;

  for (let page = 0; page < 3; page += 1) {
    const response = await axios.post(
      endpoint,
      {
        query: '',
        page,
        hitsPerPage,
        filters: 'inPromotion:true',
      },
      {
        timeout: 30000,
        headers,
      }
    );

    const pageHits = Array.isArray(response.data?.hits) ? response.data.hits : [];
    hits.push(...pageHits);

    if (pageHits.length < hitsPerPage) {
      break;
    }
  }

  return hits;
}

function buildOfficialMatchKey({ title, currentPrice, unitPrice, unit }) {
  return [
    normalizeTitleForMatch(title),
    String(currentPrice ?? ''),
    String(unitPrice ?? ''),
    String(unit || ''),
  ].join('::');
}

async function attachBillaOfficialEvidence({ source, crawlJobId, region }) {
  const hits = await fetchBillaAlgoliaPromotionHits();
  const payload = {
    retailerKey: source.retailerKey,
    hitCount: hits.length,
    sample: hits.slice(0, 25),
  };

  await createCompactRawDocument({
    sourceId: source._id,
    crawlJobId,
    retailerKey: source.retailerKey,
    region,
    documentType: 'json',
    url: source.sourceUrl,
    canonicalUrl: source.sourceUrl,
    title: `${source.label} Algolia Promotions`,
    contentHash: createHash(JSON.stringify(payload)),
    contentSnippet: `Official BILLA promotion hits: ${hits.length}`,
    extractedPreview: hits.slice(0, 10).map((hit) => hit.name).filter(Boolean),
    payload: {
      retailerKey: source.retailerKey,
      hitCount: hits.length,
      sampleNames: hits.slice(0, 5).map((hit) => sanitizeWhitespace(hit?.name || '')).filter(Boolean),
    },
  });

  const now = new Date();
  const currentOffers = await Offer.find({
    retailerKey: source.retailerKey,
    validFrom: { $lte: now },
    validTo: { $gte: now },
  })
    .select('_id title brand priceCurrent normalizedUnitPrice imageUrl')
    .lean();

  const offerMap = new Map();

  for (const offer of currentOffers) {
    const exactKey = buildOfficialMatchKey({
      title: `${offer.brand || ''} ${offer.title}`,
      currentPrice: offer.priceCurrent?.amount,
      unitPrice: offer.normalizedUnitPrice?.amount,
      unit: offer.normalizedUnitPrice?.unit,
    });
    const titlePriceKey = [
      normalizeTitleForMatch(`${offer.brand || ''} ${offer.title}`),
      String(offer.priceCurrent?.amount ?? ''),
    ].join('::');

    if (!offerMap.has(exactKey)) {
      offerMap.set(exactKey, []);
    }

    if (!offerMap.has(titlePriceKey)) {
      offerMap.set(titlePriceKey, []);
    }

    offerMap.get(exactKey).push(offer);
    offerMap.get(titlePriceKey).push(offer);
  }

  const evidence = buildSourceEvidence({
    source,
    observedUrl: source.sourceUrl,
    matchType: 'official-confirmed',
  });
  const updates = [];
  let matchedOffers = 0;

  for (const hit of hits) {
    const { currentPrice, unit } = buildBillaPrice(hit);
    const normalizedUnitPrice = buildBillaNormalizedUnitPrice(hit, currentPrice);
    const exactKey = buildOfficialMatchKey({
      title: `${hit.brand?.name || ''} ${hit.name || ''}`,
      currentPrice,
      unitPrice: normalizedUnitPrice.amount,
      unit: normalizedUnitPrice.unit || unit,
    });
    const titlePriceKey = [
      normalizeTitleForMatch(`${hit.brand?.name || ''} ${hit.name || ''}`),
      String(currentPrice ?? ''),
    ].join('::');
    const matches = offerMap.get(exactKey) || offerMap.get(titlePriceKey) || [];

    for (const match of matches) {
      matchedOffers += 1;
      updates.push({
        updateOne: {
          filter: { _id: match._id },
          update: {
            $addToSet: {
              supportingSources: evidence,
            },
            ...(match.imageUrl ? {} : { $set: { imageUrl: hit.images?.[0] || '' } }),
          },
        },
      });
    }
  }

  if (updates.length > 0) {
    await Offer.bulkWrite(updates, { ordered: false });
  }

  return {
    hitCount: hits.length,
    matchedOffers,
    rawDocuments: 1,
  };
}

function determineBillaBenefitType(hit) {
  const tags = [...(hit?.price?.regular?.tags || []), ...(hit?.price?.loyalty?.tags || [])].join(' ');

  if (/pt-multi|pt-2plus1|pt-4plus2|pt-7plus1/i.test(tags)) {
    return 'multi-buy';
  }

  if (hit?.price?.crossed || hit?.price?.discountPercentage) {
    return 'price-cut';
  }

  return 'unknown';
}

function buildBillaConditionsText(hit) {
  return sanitizeWhitespace(
    [
      hit?.price?.regular?.promotionText || '',
      hit?.price?.loyalty?.promotionText || '',
    ]
      .filter(Boolean)
      .join(' / ')
  );
}

function normalizeBillaPromotionToOffer({ hit, source, crawlJobId, region, observedUrl }) {
  const { currentPrice, referencePrice } = buildBillaPrice(hit);
  const normalizedUnitPrice = buildBillaNormalizedUnitPrice(hit, currentPrice);
  const title = sanitizeWhitespace(`${hit?.brand?.name || ''} ${hit?.name || ''}`) || sanitizeWhitespace(hit?.name || '');
  const categoryPrimary = determineOfferCategory({
    title,
    contextText: hit?.category || '',
    sourceCategory: hit?.category || '',
  });
  const scopeDecision = buildInclusiveScopeDecision();
  const quantityText = sanitizeWhitespace(
    [hit?.amount, hit?.volumeLabelShort || hit?.packageLabel || hit?.packageLabelKey].filter(Boolean).join(' ')
  );
  const conditionsText = buildBillaConditionsText(hit);
  const customerProgramRequired = Boolean(hit?.price?.loyalty);
  const issues = [];

  if (!normalizedUnitPrice.comparable) {
    issues.push('Vergleichseinheit unsicher oder nicht ableitbar');
  }

  issues.push('Gueltigkeitsende aus offizieller Quelle nicht eindeutig ableitbar');

  if (customerProgramRequired) {
    issues.push('Angebot erfordert Kundenprogramm oder App');
  }

  return applyManualCategoryOverridesToOfferSync({
    crawlJobId,
    sourceId: source._id,
    retailerKey: source.retailerKey,
    retailerName: source.retailerName,
    region,
    title,
    brand: sanitizeWhitespace(hit?.brand?.name || ''),
    categoryPrimary,
    categorySecondary: determineOfferSubcategory({
      primaryCategory: categoryPrimary,
      sourceCategory: hit?.category || '',
      fallbackLabel: categoryPrimary,
      title,
      contextText: hit?.category || '',
    }),
    comparisonSignature: normalizeTitleForMatch(title).split(' ').slice(0, 8).join('-'),
    comparisonQuantityKey: quantityText ? normalizeTitleForMatch(quantityText).replace(/[^a-z0-9]+/g, '-') : '',
    comparisonCategoryKey: normalizeTitleForMatch(hit?.category || categoryPrimary).replace(/[^a-z0-9]+/g, '-'),
    description: sanitizeWhitespace(hit?.descriptionShort || hit?.descriptionLong || ''),
    sourceUrl: observedUrl || source.sourceUrl,
    imageUrl: hit?.images?.[0] || '',
    supportingSources: [
      buildSourceEvidence({
        source,
        observedUrl: observedUrl || source.sourceUrl,
        matchType: 'primary',
      }),
    ],
    validFrom: new Date(),
    validTo: null,
    benefitType: determineBillaBenefitType(hit),
    conditionsText,
    customerProgramRequired,
    availabilityScope: region || 'Grossraum Graz',
    priceCurrent: {
      amount: currentPrice,
      currency: 'EUR',
      originalText: currentPrice ? `${currentPrice.toFixed(2)} EUR` : '',
    },
    priceReference: {
      amount: referencePrice,
      currency: 'EUR',
      originalText: referencePrice ? `${referencePrice.toFixed(2)} EUR` : '',
    },
    quantityText,
    normalizedUnitPrice,
    quality: {
      completenessScore: [currentPrice, title, categoryPrimary].filter(Boolean).length / 3,
      parsingConfidence: normalizedUnitPrice.comparable ? 0.88 : 0.76,
      comparisonSafe: normalizedUnitPrice.comparable,
      issues,
    },
    rawFacts: {
      sourceType: 'billa-official-algolia',
      objectID: hit?.objectID || '',
      sku: hit?.sku || '',
      category: hit?.category || '',
      tags: hit?.price?.regular?.tags || [],
      loyaltyTags: hit?.price?.loyalty?.tags || [],
      snapshotCurrent: true,
    },
    adminReview: {
      status: issues.length > 0 ? 'pending' : 'reviewed',
      note: '',
      feedbackDigest: '',
    },
    scope: scopeDecision,
  }).offer;
}

async function crawlBillaOfficialPromotions({ source, crawlJobId, region }) {
  const hits = await fetchBillaAlgoliaPromotionHits();
  const payload = {
    retailerKey: source.retailerKey,
    hitCount: hits.length,
    sample: hits.slice(0, 25),
  };

  await Offer.deleteMany({ sourceId: source._id });

  await createCompactRawDocument({
    sourceId: source._id,
    crawlJobId,
    retailerKey: source.retailerKey,
    region,
    documentType: 'json',
    url: source.sourceUrl,
    canonicalUrl: source.sourceUrl,
    title: `${source.label} Algolia Promotions`,
    contentHash: createHash(JSON.stringify(payload)),
    contentSnippet: `Official BILLA promotion hits: ${hits.length}`,
    extractedPreview: hits.slice(0, 10).map((hit) => hit.name).filter(Boolean),
    payload: {
      retailerKey: source.retailerKey,
      hitCount: hits.length,
      sampleNames: hits.slice(0, 5).map((hit) => sanitizeWhitespace(hit?.name || '')).filter(Boolean),
    },
  });

  const normalizedOffers = hits.map((hit) =>
    normalizeBillaPromotionToOffer({
      hit,
      source,
      crawlJobId,
      region,
      observedUrl: source.sourceUrl,
    })
  );
  const offerDocuments = normalizedOffers.map(({ scope, ...offer }) => offer);

  if (offerDocuments.length > 0) {
    await Offer.insertMany(offerDocuments, { ordered: false });
  }

  return {
    hitCount: hits.length,
    offerDocuments,
    rawDocuments: 1,
  };
}

async function crawlPennyOfficialOffers({ source, crawlJobId, region, html, canonicalUrl }) {
  await Offer.deleteMany({ sourceId: source._id });

  const normalizedOffers = parsePennyOffersFromHtml({
    html,
    source,
    crawlJobId,
    region,
    pageUrl: canonicalUrl || source.sourceUrl,
  });
  const offerDocuments = normalizedOffers.map(({ scope, ...offer }) => offer);

  if (offerDocuments.length > 0) {
    await Offer.insertMany(offerDocuments, { ordered: false });
  }

  return {
    offerDocuments,
    rawDocuments: 0,
  };
}

async function crawlLidlOfficialFlyers({ source, crawlJobId, region, html }) {
  const flyerIdentifiers = extractLidlFlyerIdentifiers(html);
  const collectedOffers = [];
  const seenFlyers = [];

  await Offer.deleteMany({ sourceId: source._id });

  for (const identifier of flyerIdentifiers.slice(0, 8)) {
    let flyer = null;

    try {
      flyer = await fetchLidlFlyerByIdentifier(identifier);
    } catch (error) {
      continue;
    }

    if (!flyer?.isActive || !flyer?.products || Object.keys(flyer.products).length === 0) {
      continue;
    }

    seenFlyers.push({
      id: flyer.id,
      name: flyer.name,
      title: flyer.title,
      productCount: Object.keys(flyer.products).length,
      offerStartDate: flyer.offerStartDate || flyer.startDate,
      offerEndDate: flyer.offerEndDate || flyer.endDate,
      url: flyer.flyerUrlAbsolute,
    });

    for (const product of Object.values(flyer.products)) {
      const normalized = normalizeLidlProductToOffer({
        product,
        flyer,
        source,
        crawlJobId,
        region,
      });

      if (normalized) {
        collectedOffers.push(normalized);
      }
    }
  }

  const seen = new Set();
  const offerDocuments = collectedOffers
    .map(({ scope, ...offer }) => offer)
    .filter((offer) => {
      const key = [
        sanitizeWhitespace(offer.rawFacts?.productId || ''),
        normalizeTitleForMatch(`${offer.brand || ''} ${offer.title || ''}`),
        String(offer.priceCurrent?.amount ?? ''),
        String(offer.validFrom?.toISOString?.() || ''),
      ].join('::');

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });

  if (offerDocuments.length > 0) {
    await Offer.insertMany(offerDocuments, { ordered: false });
  }

  await createCompactRawDocument({
    sourceId: source._id,
    crawlJobId,
    retailerKey: source.retailerKey,
    region,
    documentType: 'json',
    url: source.sourceUrl,
    canonicalUrl: source.sourceUrl,
    title: `${source.label} Flyer Snapshot`,
    contentHash: createHash(JSON.stringify(seenFlyers)),
    contentSnippet: `Lidl official flyer API: ${seenFlyers.length} produktfaehige Flyer, ${offerDocuments.length} Offers.`,
    extractedPreview: seenFlyers.slice(0, 5).map((item) => `${item.name} (${item.productCount})`),
    payload: {
      flyerCount: seenFlyers.length,
      offerCount: offerDocuments.length,
      flyers: seenFlyers.slice(0, 6),
    },
  });

  return {
    offerDocuments,
    rawDocuments: 1,
  };
}

async function crawlBipaOfficialOffers({ source, crawlJobId, region, html, canonicalUrl }) {
  const collectedOffers = [];
  const validToHint = extractBipaValidityDate(html);
  const pageCandidates = [
    { url: canonicalUrl || source.sourceUrl, html },
  ];
  const additionalLinks = collectBipaPromotionLinks(html, canonicalUrl || source.sourceUrl);

  for (const link of additionalLinks) {
    if (pageCandidates.some((item) => item.url === link.url)) {
      continue;
    }

    try {
      const nested = await fetchHtml(link.url);
      pageCandidates.push({
        url: nested.canonicalUrl || link.url,
        html: nested.html,
      });
    } catch (error) {
      // Continue with the pages that were fetched successfully.
    }
  }

  await Offer.deleteMany({ sourceId: source._id });

  for (const page of pageCandidates) {
    const pageOffers = parseBipaOffersFromHtml({
      html: page.html,
      source,
      crawlJobId,
      region,
      pageUrl: page.url,
      validToHint,
    });

    collectedOffers.push(...pageOffers);
  }

  const seen = new Set();
  const offerDocuments = collectedOffers
    .map(({ scope, ...offer }) => offer)
    .filter((offer) => {
      const key = [
        normalizeTitleForMatch(`${offer.brand || ''} ${offer.title || ''}`),
        String(offer.priceCurrent?.amount ?? ''),
        String(offer.quantityText || ''),
      ].join('::');

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });

  if (offerDocuments.length > 0) {
    await Offer.insertMany(offerDocuments, { ordered: false });
  }

  return {
    offerDocuments,
    rawDocuments: 0,
  };
}

async function fetchNestedHtmlDocuments({ source, crawlJobId, region, links, limit = 4 }) {
  const baseHost = new URL(source.sourceUrl).host;
  const pageLinks = links
    .filter((item) => item.type === 'page')
    .filter((item) => {
      try {
        return new URL(item.url).host === baseHost;
      } catch (error) {
        return false;
      }
    })
    .slice(0, limit);
  const rawDocuments = [];

  for (const link of pageLinks) {
    try {
      const { html, canonicalUrl } = await fetchHtml(link.url);
      const title = sanitizeWhitespace(cheerio.load(html)('title').text()) || link.label;

      rawDocuments.push(
        await createCompactRawDocument({
          sourceId: source._id,
          crawlJobId,
          retailerKey: source.retailerKey,
          region,
          documentType: 'html',
          url: link.url,
          canonicalUrl,
          title,
          contentHash: createHash(html),
          contentSnippet: sanitizeWhitespace(cheerio.load(html)('body').text()).slice(0, 500),
          extractedPreview: [],
          payload: {
            parentSourceUrl: source.sourceUrl,
            discoveredFrom: source.label,
          },
        })
      );
    } catch (error) {
      rawDocuments.push({
        error: error.message,
        url: link.url,
      });
    }
  }

  return rawDocuments;
}

async function crawlHoferOfficialPages({ source, crawlJobId, region, links }) {
  const datedLinks = links
    .filter((item) => /\/de\/angebote\/d\.\d{2}-\d{2}-\d{4}\.html/i.test(item.url))
    .map((item) => ({
      ...item,
      pageDate: parseHoferDateFromUrl(item.url),
    }))
    .filter((item) => item.pageDate)
    .sort((left, right) => left.pageDate.getTime() - right.pageDate.getTime());
  const allOffers = [];
  let rawDocumentCount = 0;

  await Offer.deleteMany({ sourceId: source._id });

  for (let index = 0; index < datedLinks.length; index += 1) {
    const current = datedLinks[index];
    const next = datedLinks[index + 1];
    const { html, canonicalUrl } = await fetchHtml(current.url);
    const title = sanitizeWhitespace(cheerio.load(html)('title').text()) || current.label;

    await createCompactRawDocument({
      sourceId: source._id,
      crawlJobId,
      retailerKey: source.retailerKey,
      region,
      documentType: 'html',
      url: current.url,
      canonicalUrl,
      title,
      contentHash: createHash(html),
      contentSnippet: sanitizeWhitespace(cheerio.load(html)('body').text()).slice(0, 500),
      extractedPreview: [],
      payload: {
        parentSourceUrl: source.sourceUrl,
        pageDate: current.pageDate,
      },
    });

    rawDocumentCount += 1;

    const pageOffers = parseHoferOffersFromPage({
      html,
      pageUrl: current.url,
      source,
      crawlJobId,
      region,
      pageDate: current.pageDate,
      nextPageDate: next?.pageDate || null,
    });

    allOffers.push(...pageOffers);
  }

  const offerDocuments = allOffers.map(({ scope, ...offer }) => offer);

  if (offerDocuments.length > 0) {
    await Offer.insertMany(offerDocuments, { ordered: false });
  }

  return {
    offerDocuments,
    rawDocumentCount,
  };
}

async function crawlOfficialSource({ source, region, trigger = 'manual' }) {
  const crawlJob = await CrawlJob.create({
    sourceId: source._id,
    retailerKey: source.retailerKey,
    region,
    trigger,
    metadata: {
      sourceLabel: source.label,
      sourceUrl: source.sourceUrl,
    },
  });

  try {
    await clearRawDocumentsForSource(source._id);

    const { html, canonicalUrl } = await fetchHtml(source.sourceUrl);
    const links = extractRelevantLinks({
      html,
      baseUrl: canonicalUrl,
      retailerKey: source.retailerKey,
    });
    const pageTitle = sanitizeWhitespace(cheerio.load(html)('title').text()) || source.label;

    const rootDocument = await createCompactRawDocument({
      sourceId: source._id,
      crawlJobId: crawlJob._id,
      retailerKey: source.retailerKey,
      region,
      documentType: 'html',
      url: source.sourceUrl,
      canonicalUrl,
      title: pageTitle,
      contentHash: createHash(html),
      contentSnippet: sanitizeWhitespace(cheerio.load(html)('body').text()).slice(0, 500),
      extractedPreview: links.slice(0, 10).map((item) => `${item.type.toUpperCase()}: ${item.label}`),
      payload: {
        linkCount: links.length,
        pageLinkCount: links.filter((item) => item.type === 'page').length,
        pdfLinkCount: links.filter((item) => item.type === 'pdf').length,
      },
    });

    let offersStored = 0;
    let evidenceMatched = 0;
    let extraRawDocuments = 0;
    let warningMessages = [];

    if (source.retailerKey === 'hofer' && source.channel === 'official-flyer') {
      const hoferResult = await crawlHoferOfficialPages({
        source,
        crawlJobId: crawlJob._id,
        region,
        links,
      });

      offersStored += hoferResult.offerDocuments.length;
      extraRawDocuments += hoferResult.rawDocumentCount;
    } else if (source.sourceUrl.includes('billa.at/unsere-aktionen/aktionen')) {
      const billaOfficialResult = await crawlBillaOfficialPromotions({
        source,
        crawlJobId: crawlJob._id,
        region,
      });

      offersStored += billaOfficialResult.offerDocuments.length;
      extraRawDocuments += billaOfficialResult.rawDocuments;
    } else if (source.retailerKey === 'penny' && source.sourceUrl.includes('penny.at/angebote')) {
      const pennyOfficialResult = await crawlPennyOfficialOffers({
        source,
        crawlJobId: crawlJob._id,
        region,
        html,
        canonicalUrl,
      });

      offersStored += pennyOfficialResult.offerDocuments.length;
      extraRawDocuments += pennyOfficialResult.rawDocuments;
    } else if (source.retailerKey === 'lidl' && source.sourceUrl.includes('lidl.at/c/flugblatt')) {
      const lidlOfficialResult = await crawlLidlOfficialFlyers({
        source,
        crawlJobId: crawlJob._id,
        region,
        html,
      });

      offersStored += lidlOfficialResult.offerDocuments.length;
      extraRawDocuments += lidlOfficialResult.rawDocuments;
    } else if (source.retailerKey === 'bipa' && source.sourceUrl.includes('bipa.at/cp/aktionen')) {
      const bipaOfficialResult = await crawlBipaOfficialOffers({
        source,
        crawlJobId: crawlJob._id,
        region,
        html,
        canonicalUrl,
      });

      offersStored += bipaOfficialResult.offerDocuments.length;
      extraRawDocuments += bipaOfficialResult.rawDocuments;
    } else {
      const nestedDocuments = await fetchNestedHtmlDocuments({
        source,
        crawlJobId: crawlJob._id,
        region,
        links,
      });

      extraRawDocuments += nestedDocuments.filter((item) => item && !item.error).length;
    }

    const status = offersStored > 0 || evidenceMatched > 0 || links.length > 0 ? 'success' : 'partial';

    await CrawlJob.findByIdAndUpdate(crawlJob._id, {
      status,
      finishedAt: new Date(),
      stats: {
        discoveredPages: Math.max(links.length, 1),
        rawDocuments: 1 + extraRawDocuments,
        offersExtracted: offersStored,
        offersStored,
        warnings: warningMessages.length,
        errors: 0,
      },
      warningMessages,
      errorMessages: [],
      metadata: {
        sourceLabel: source.label,
        sourceUrl: source.sourceUrl,
        rawDocumentId: rootDocument._id,
        extractedLinkCount: links.length,
        evidenceMatched,
      },
    });

    await Source.findByIdAndUpdate(source._id, {
      latestRunAt: new Date(),
      latestStatus: status,
    });

    return {
      retailerKey: source.retailerKey,
      retailerName: source.retailerName,
      channel: source.channel,
      offersStored,
      evidenceMatched,
      discoveredLinks: links.length,
      sourceUrl: source.sourceUrl,
    };
  } catch (error) {
    await CrawlJob.findByIdAndUpdate(crawlJob._id, {
      status: 'failed',
      finishedAt: new Date(),
      stats: {
        discoveredPages: 1,
        rawDocuments: 0,
        offersExtracted: 0,
        offersStored: 0,
        warnings: 0,
        errors: 1,
      },
      warningMessages: [],
      errorMessages: [error.message],
    });

    await Source.findByIdAndUpdate(source._id, {
      latestRunAt: new Date(),
      latestStatus: 'failed',
    });

    throw error;
  }
}

module.exports = {
  crawlOfficialSource,
};
