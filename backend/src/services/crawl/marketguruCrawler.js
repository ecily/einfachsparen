const axios = require('axios');
const cheerio = require('cheerio');
const Source = require('../../models/Source');
const CrawlJob = require('../../models/CrawlJob');
const Offer = require('../../models/Offer');
const {
  sanitizeWhitespace,
  normalizeTitleForMatch,
  buildSourceEvidence,
} = require('./sourceEvidence');
const { clearRawDocumentsForSource, createCompactRawDocument } = require('./rawDocumentStorage');

function createHash(value) {
  return require('node:crypto').createHash('sha256').update(String(value || '')).digest('hex');
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

function normalizeUnit(value) {
  const normalized = normalizeTitleForMatch(value);

  if (/^(stuck|stueck|stk)$/.test(normalized)) {
    return 'Stk';
  }

  if (/^(kg|kilogramm)$/.test(normalized)) {
    return 'kg';
  }

  if (/^(g|gramm)$/.test(normalized)) {
    return 'g';
  }

  if (/^(l|liter)$/.test(normalized)) {
    return 'l';
  }

  if (/^(ml|milliliter)$/.test(normalized)) {
    return 'ml';
  }

  if (/^(cl|zentiliter)$/.test(normalized)) {
    return 'cl';
  }

  return sanitizeWhitespace(value);
}

function parseDateRange(value) {
  const now = new Date();
  const withYearMatch = String(value || '').match(/(\d{2})\.(\d{2})\.(\d{4})\s*-\s*(\d{2})\.(\d{2})\.(\d{4})/);

  if (withYearMatch) {
    const [, startDay, startMonth, startYear, endDay, endMonth, endYear] = withYearMatch.map(Number);

    return {
      validFrom: new Date(Date.UTC(startYear, startMonth - 1, startDay, 12, 0, 0)),
      validTo: new Date(Date.UTC(endYear, endMonth - 1, endDay, 12, 0, 0)),
    };
  }

  const shortMatch = String(value || '').match(/(\d{2})\.(\d{2})\.\s*-\s*(\d{2})\.(\d{2})\./);

  if (!shortMatch) {
    return {
      validFrom: null,
      validTo: null,
    };
  }

  const startDay = Number(shortMatch[1]);
  const startMonth = Number(shortMatch[2]);
  const endDay = Number(shortMatch[3]);
  const endMonth = Number(shortMatch[4]);
  const currentYear = now.getUTCFullYear();
  let startYear = currentYear;
  let endYear = currentYear;

  if (endMonth < startMonth) {
    endYear += 1;
  }

  return {
    validFrom: new Date(Date.UTC(startYear, startMonth - 1, startDay, 12, 0, 0)),
    validTo: new Date(Date.UTC(endYear, endMonth - 1, endDay, 12, 0, 0)),
  };
}

function determineCategory(title = '', categoryHint = '') {
  const haystack = normalizeTitleForMatch(`${title} ${categoryHint}`);

  if (
    /(bier|wein|wasser|saft|cola|getrank|getraenke|schaumwein|spirituose|whisky|limonade|kaffee|tee|sirup|eistee|smoothie|energydrink|rotwein|weisswein|rose|aperitif|digestif|schnaps|gin|vodka|likor|likor|sekt|prosecco|joghurtgetrank|milchgetrank)/.test(
      haystack
    )
  ) {
    return 'Getraenke';
  }

  if (
    /(shampoo|dusch|zahnpasta|zahnburste|zahnbuerste|aufsteckburste|aufsteckbuerste|deo|deodorant|hygiene|drogerie|kosmetik|seife|windel|toilettenpapier|hygienepapier|einlagen|binden|gesichtspflege|hautpflege)/.test(
      haystack
    )
  ) {
    return 'Drogerie / Hygiene';
  }

  if (
    /(haushalt|reiniger|muellbeutel|geschirr|waschmittel|papier|kuche|kueche|haushalts|schwamm|folie|beutel|tabs|pads|spulmittel|spuelmittel|reinigungsgerate|reinigungsgeraete|tucher|tuecher)/.test(
      haystack
    )
  ) {
    return 'Haushalt';
  }

  return 'Lebensmittel';
}

function detectScopeDecision({ title = '', categoryPrimary = '', infoText = '' }) {
  const haystack = normalizeTitleForMatch(`${title} ${categoryPrimary} ${infoText}`);
  const excludedPatterns = [
    /(damenbekleidung|herrenbekleidung|kinderbekleidung|bekleidung|mode|shirt|hose|jacke|socke|schuh|sandale|pyjama|pullover|kleid|leggings|unterwasche|unterhemd|cardigan)/,
    /(pflanze|blume|orchidee|blumenerde|hochbeeterde|erde|kompost|gartenpflanze|gartnern|topfpflanze|garten)/,
    /(werkzeug|akkuschrauber|bohrer|maschine|drucker|monitor|tablet|smartphone|kopfhorer|fernseher|tv|notebook|laptop|kamera|montagestander|montagestaender|helm)/,
    /(spielzeug|fahrrad|autozubehor|motoroel|reifen|sportartikel|camping)/,
    /(katzenfutter|hundefutter|tiernahrung|haustier|katzenstreu|katzenpflege|nassfutter|trockenfutter)/,
  ];

  if (excludedPatterns.some((pattern) => pattern.test(haystack))) {
    return {
      included: false,
      reason: 'Kategorie liegt ausserhalb des V1-Scope',
    };
  }

  return {
    included: ['Lebensmittel', 'Getraenke', 'Drogerie / Hygiene', 'Haushalt'].includes(categoryPrimary),
    reason: '',
  };
}

function parseNormalizedUnitPrice(infoText, currentPrice) {
  const match = String(infoText || '').match(/€?\s*([\d,.]+)\s*\/\s*([A-Za-zäöüÄÖÜß]+)\s*-\s*(.+)$/i);

  if (!match) {
    return {
      normalizedUnitPrice: {
        amount: null,
        unit: '',
        comparable: false,
        confidence: 0,
      },
      quantityText: sanitizeWhitespace(infoText),
      conditionsText: '',
    };
  }

  const amount = parseNumericAmount(match[1]);
  const unit = normalizeUnit(match[2]);
  const remainder = sanitizeWhitespace(match[3]);
  let quantityText = remainder;
  let conditionsText = '';

  const hintMatch = remainder.match(/hinweis\s*:\s*(.+)$/i);

  if (hintMatch) {
    conditionsText = sanitizeWhitespace(hintMatch[1]);
    quantityText = sanitizeWhitespace(remainder.replace(/hinweis\s*:\s*.+$/i, ''));
  }

  const multiBuyMatch = remainder.match(/\bab\s+(\d+)\s*(stk|stueck|stuck)\b/i);

  if (multiBuyMatch) {
    conditionsText = [conditionsText, `ab ${multiBuyMatch[1]} Stk.`].filter(Boolean).join(' / ');
  }

  return {
    normalizedUnitPrice: {
      amount,
      unit,
      comparable: Boolean(amount && ['kg', 'l', 'Stk'].includes(unit)),
      confidence: amount ? 0.86 : 0,
    },
    quantityText,
    conditionsText,
  };
}

function buildComparisonSignature({ title = '', brand = '' }) {
  const stopwords = new Set([
    'adeg',
    'aktiv',
    'bipa',
    'billa',
    'dm',
    'drogerie',
    'hofer',
    'lidl',
    'markt',
    'pagro',
    'penny',
    'spar',
    'diskont',
  ]);

  return normalizeTitleForMatch(`${brand} ${title}`)
    .split(' ')
    .filter((token) => token.length > 2 && !stopwords.has(token))
    .slice(0, 8)
    .join('-');
}

function extractOfferLink(card, sourceUrl) {
  const retailerLink = card.find('.retailer a[href]').first().attr('href');
  const href = retailerLink || card.find('a[href]').first().attr('href');

  if (!href) {
    return sourceUrl;
  }

  try {
    return new URL(href, sourceUrl).toString();
  } catch (error) {
    return sourceUrl;
  }
}

function parseOffersFromHtml({ html, source, crawlJobId, region }) {
  const $ = cheerio.load(html);
  const now = new Date();
  const offers = [];

  $('.offer-list-item').each((index, element) => {
    const card = $(element);
    const title = sanitizeWhitespace(card.find('h3').first().text());
    const brand = sanitizeWhitespace(card.find('dd.brand').first().text());
    const currentPrice = parseNumericAmount(card.find('.price-bubble .price').first().text());
    const oldPrice = parseNumericAmount(card.find('.price-bubble .old-price').first().text());
    const validityText = sanitizeWhitespace(card.find('dd.valid').first().text());
    const infoText = sanitizeWhitespace(card.find('.info').text());
    const imageUrl = sanitizeWhitespace(card.find('img.offer-list-item-img').attr('src'));
    const observedUrl = extractOfferLink(card, source.sourceUrl);
    const { validFrom, validTo } = parseDateRange(validityText);

    if (!title || !currentPrice) {
      return;
    }

    if (validTo && validTo < now) {
      return;
    }

    if (validFrom && validFrom > now) {
      return;
    }

    const categoryPrimary = determineCategory(title, infoText);
    const scopeDecision = detectScopeDecision({
      title,
      categoryPrimary,
      infoText,
    });
    const parsedInfo = parseNormalizedUnitPrice(infoText, currentPrice);
    const normalizedInfoText = normalizeTitleForMatch(infoText);
    const customerProgramRequired = /(kundenkarte|app|lidl plus|joe|karte|club|bonuskarte|payback)/i.test(
      normalizedInfoText
    );
    const issues = [];

    if (!scopeDecision.included) {
      issues.push(scopeDecision.reason || 'Kategorie liegt ausserhalb des V1-Scope');
    }

    if (!parsedInfo.normalizedUnitPrice.comparable) {
      issues.push('Vergleichseinheit unsicher oder nicht ableitbar');
    }

    if (!validFrom || !validTo) {
      issues.push('Gueltigkeitszeitraum unvollstaendig');
    }

    if (customerProgramRequired) {
      issues.push('Angebot erfordert Kundenprogramm oder App');
    }

    offers.push({
      crawlJobId,
      sourceId: source._id,
      retailerKey: source.retailerKey,
      retailerName: source.retailerName,
      region,
      title,
      brand,
      categoryPrimary,
      categorySecondary: categoryPrimary,
      comparisonSignature: buildComparisonSignature({ title, brand }),
      comparisonQuantityKey: parsedInfo.quantityText
        ? normalizeTitleForMatch(parsedInfo.quantityText).replace(/[^a-z0-9]+/g, '-')
        : '',
      comparisonCategoryKey: normalizeTitleForMatch(categoryPrimary).replace(/[^a-z0-9]+/g, '-'),
      description: '',
      sourceUrl: observedUrl,
      imageUrl,
      supportingSources: [
        buildSourceEvidence({
          source,
          observedUrl,
          matchType: 'primary',
        }),
      ],
      validFrom,
      validTo,
      benefitType: oldPrice && oldPrice > currentPrice ? 'price-cut' : 'unknown',
      conditionsText: parsedInfo.conditionsText,
      customerProgramRequired,
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
      quantityText: parsedInfo.quantityText,
      normalizedUnitPrice: parsedInfo.normalizedUnitPrice,
      quality: {
        completenessScore: [currentPrice, validFrom, validTo, categoryPrimary].filter(Boolean).length / 4,
        parsingConfidence: parsedInfo.normalizedUnitPrice.comparable ? 0.86 : 0.74,
        comparisonSafe: parsedInfo.normalizedUnitPrice.comparable && scopeDecision.included,
        issues,
      },
      rawFacts: {
        sourceType: 'marketguru-html',
        validityText,
        infoText,
        snapshotCurrent: false,
      },
      adminReview: {
        status: issues.length > 0 ? 'pending' : 'reviewed',
        note: '',
        feedbackDigest: '',
      },
      scope: scopeDecision,
    });
  });

  return offers;
}

async function crawlMarktguruSource({ source, region, trigger = 'manual' }) {
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

    const response = await axios.get(source.sourceUrl, {
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'de-AT,de;q=0.9,en;q=0.8',
      },
    });

    const html = String(response.data);
    const $ = cheerio.load(html);
    const title = sanitizeWhitespace($('title').text()) || source.label;
    const rootDocument = await createCompactRawDocument({
      sourceId: source._id,
      crawlJobId: crawlJob._id,
      retailerKey: source.retailerKey,
      region,
      documentType: 'html',
      url: source.sourceUrl,
      canonicalUrl: response.request?.res?.responseUrl || source.sourceUrl,
      title,
      contentHash: createHash(html),
      contentSnippet: sanitizeWhitespace($('body').text()).slice(0, 500),
      extractedPreview: $('.offer-list-item h3')
        .slice(0, 8)
        .map((index, element) => sanitizeWhitespace($(element).text()))
        .get()
        .filter(Boolean),
      payload: {
        retailerName: source.retailerName,
        offerPreviewCount: $('.offer-list-item').length,
      },
    });

    await Offer.deleteMany({ sourceId: source._id });

    const normalizedOffers = parseOffersFromHtml({
      html,
      source,
      crawlJobId: crawlJob._id,
      region,
    });
    const filteredOutOffers = normalizedOffers.filter((offer) => offer.scope?.included === false);
    const offerDocuments = normalizedOffers
      .filter((offer) => offer.scope?.included !== false)
      .map(({ scope, ...offer }) => offer);

    if (offerDocuments.length > 0) {
      await Offer.insertMany(offerDocuments, { ordered: false });
    }

    await CrawlJob.findByIdAndUpdate(crawlJob._id, {
      status: offerDocuments.length > 0 ? 'success' : 'partial',
      finishedAt: new Date(),
      stats: {
        discoveredPages: 1,
        rawDocuments: 1,
        offersExtracted: normalizedOffers.length,
        offersStored: offerDocuments.length,
        warnings: offerDocuments.filter((offer) => offer.quality.issues.length > 0).length,
        errors: 0,
      },
      warningMessages: filteredOutOffers.length > 0
        ? [`${filteredOutOffers.length} Marktguru-Angebote ausserhalb des V1-Scope wurden nicht gespeichert.`]
        : [],
      errorMessages: [],
      metadata: {
        sourceLabel: source.label,
        sourceUrl: source.sourceUrl,
        rawDocumentId: rootDocument._id,
      },
    });

    await Source.findByIdAndUpdate(source._id, {
      latestRunAt: new Date(),
      latestStatus: offerDocuments.length > 0 ? 'success' : 'partial',
    });

    return {
      retailerKey: source.retailerKey,
      retailerName: source.retailerName,
      channel: source.channel,
      sourceUrl: source.sourceUrl,
      offersStored: offerDocuments.length,
      discoveredLinks: 1,
      evidenceMatched: 0,
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
  crawlMarktguruSource,
};
