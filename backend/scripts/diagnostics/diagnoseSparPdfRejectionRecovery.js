const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile: execFileCallback } = require('node:child_process');
const { promisify } = require('node:util');

const { PDFParse } = require('pdf-parse');

const { RETAILER_DEFINITIONS } = require('../../src/services/sources/sourceDefinitions');
const {
  buildRejectedCandidateSamples,
  buildValidityFromSource,
  extractSparPdfCandidates,
  normalizeSparPdfCandidatesToOffers,
  summarizeRejections,
} = require('../../src/services/crawl/sparOfficialFlyerPdfParser');
const { extractOfficialFlyerValidityFromPages } = require('../../src/services/crawl/officialFlyerValidity');
const { buildOfferCardDiagnostics } = require('../../src/services/crawl/sparFamilyPdfCardDetector');

const execFile = promisify(execFileCallback);

const OUT_DIR = path.resolve(__dirname, '../../tmp/diagnostics/spar-pdf-rejection-recovery');
const REPORT_JSON = path.join(OUT_DIR, 'spar-pdf-rejection-recovery-report.json');
const REPORT_MD = path.join(OUT_DIR, 'spar-pdf-rejection-recovery-report.md');

const SPAR_FORMATS = new Set(['spar', 'eurospar', 'interspar']);
const NOW = new Date('2026-06-05T12:00:00.000Z');

function sanitize(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function safeIso(value) {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : '';
}

function rejectionBucket(reason = '') {
  if (/merge-risk/.test(reason)) return 'generic-merge-risk';
  if (/quantity/.test(reason)) return 'quantity-missing';
  if (/fragment-title|title/.test(reason)) return 'title-missing';
  if (/unclear|product/.test(reason)) return 'product-unclear';
  return 'parse-failed';
}

function activeSparPdfSources() {
  return RETAILER_DEFINITIONS
    .filter((source) => source.enabled !== false)
    .filter((source) => source.channel === 'official-flyer' && source.sourceType === 'pdf')
    .filter((source) => SPAR_FORMATS.has(source.sourceRetailerFormat))
    .filter((source) => {
      const validTo = source.crawlPolicy?.validTo ? new Date(source.crawlPolicy.validTo) : null;
      return !validTo || validTo >= NOW;
    });
}

async function fetchBuffer(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/pdf,text/html,*/*;q=0.8',
      'User-Agent': 'kaufklug-readonly-spar-rejection-recovery/1.0',
    },
  });

  return {
    status: response.status,
    contentType: response.headers.get('content-type') || '',
    finalUrl: response.url,
    buffer: Buffer.from(await response.arrayBuffer()),
  };
}

async function parseTextPages(pdfBuffer, maxPages) {
  const parser = new PDFParse({ data: pdfBuffer });
  const pages = [];

  try {
    for (let page = 1; page <= maxPages; page += 1) {
      try {
        const result = await parser.getText({ partial: [page] });
        const text = result.text || '';
        if (!text && page > 1) break;
        pages.push({ pageNumber: page, text, charCount: text.length });
      } catch (error) {
        if (page === 1) throw error;
        break;
      }
    }
  } finally {
    await parser.destroy();
  }

  return pages;
}

async function extractPdfjsPages(pdfBuffer, maxPages) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await pdfjs.getDocument({
    data: new Uint8Array(pdfBuffer),
    disableWorker: true,
    useSystemFonts: true,
  }).promise;
  const pages = [];

  try {
    const pageLimit = Math.min(maxPages, document.numPages);
    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent();
      pages.push({
        pageNumber,
        itemCount: textContent.items.length,
        textItems: textContent.items.map((item) => ({
          text: sanitize(item.str || ''),
          x: Number(item.transform?.[4] || 0),
          y: Number(item.transform?.[5] || 0),
          w: Number(item.width || 0),
          h: Number(item.height || 0),
        })).filter((item) => item.text),
      });
    }
  } finally {
    await document.destroy();
  }

  return pages;
}

async function extractPyMuPdfPages(pdfPath, maxPages) {
  const python = [
    'import json, sys',
    'import fitz',
    'doc = fitz.open(sys.argv[1])',
    'limit = min(int(sys.argv[2]), doc.page_count)',
    'pages = []',
    'for i in range(limit):',
    '    page = doc.load_page(i)',
    '    words = page.get_text("words")',
    '    blocks = page.get_text("blocks")',
    '    images = []',
    '    for img in page.get_images(full=True):',
    '        xref = img[0]',
    '        rects = page.get_image_rects(xref)',
    '        for rect in rects:',
    '            images.append({"x": rect.x0, "y": rect.y0, "w": rect.width, "h": rect.height})',
    '    pages.append({"pageNumber": i + 1, "wordCount": len(words), "blockCount": len(blocks), "imageCount": len(images), "images": images[:80]})',
    'print(json.dumps({"ok": True, "pages": pages}))',
  ].join('\n');

  try {
    const result = await execFile('python', ['-c', python, pdfPath, String(maxPages)], {
      timeout: 120000,
      maxBuffer: 20 * 1024 * 1024,
    });
    return JSON.parse(result.stdout || '{}');
  } catch (error) {
    return {
      ok: false,
      error: error.message || String(error),
      pages: [],
    };
  }
}

function sourceForNormalize(source) {
  return {
    _id: source._id || source.sourceId || `diagnostic-${source.sourceRetailerFormat}`,
    retailerKey: source.retailerKey,
    retailerName: source.retailerName,
    channel: source.channel,
    sourceUrl: source.sourceUrl,
    sourceType: source.sourceType,
    sourceRetailerName: source.sourceRetailerName || source.retailerName,
    sourceRetailerFormat: source.sourceRetailerFormat,
    appliesToRetailerFormats: source.appliesToRetailerFormats || [source.sourceRetailerFormat],
    retailerFormatLabel: source.retailerFormatLabel,
    crawlPolicy: source.crawlPolicy || {},
  };
}

function pdfReferenceFor({ source, pages, candidates, validity }) {
  return {
    file: { sourceUrl: source.sourceUrl, pages: pages.length },
    validity,
    pages: pages.map((page) => ({
      page: page.pageNumber,
      charCount: page.charCount,
      candidateCount: candidates.filter((candidate) => candidate.page === page.pageNumber).length,
    })),
    candidates,
    textLength: pages.reduce((sum, page) => sum + page.charCount, 0),
  };
}

function candidatePriceTokens(candidate) {
  return [...String(candidate.rawText || '').matchAll(/\b\d{1,3}[,.]\d{2}\b/g)].map((match) => match[0]).slice(0, 8);
}

function candidateQuantityTokens(candidate) {
  return [...String(candidate.rawText || '').matchAll(/\b\d+(?:[,.]\d+)?\s*(?:kg|g|l|liter|ml|stk|stueck|pkg|packungen|flaschen|dosen)\b/ig)].map((match) => match[0]).slice(0, 8);
}

function nearestCards(cards = [], candidate = {}) {
  const text = sanitize(`${candidate.title || ''} ${candidate.rawText || ''}`);
  if (!text) return cards.slice(0, 3);
  const titleKey = sanitize(candidate.title || '').toLowerCase();
  return cards
    .map((card) => {
      const haystack = `${card.title || ''} ${card.rawZoneText || ''}`.toLowerCase();
      let score = 0;
      if (titleKey && haystack.includes(titleKey)) score += 4;
      for (const token of text.toLowerCase().split(/[^a-z0-9]+/).filter((part) => part.length >= 4)) {
        if (haystack.includes(token)) score += 1;
      }
      return { card, score };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map((entry) => entry.card);
}

function recoverabilityFor({ candidate, cards }) {
  const matchingCards = nearestCards(cards, candidate);
  const publishableCards = matchingCards.filter((card) => isProductionSafeLayoutCard(card));
  const noReasons = new Set();

  if (publishableCards.length) {
    return {
      publishable: true,
      confidence: publishableCards[0].confidence,
      reason: 'layout-card-detector-found-publishable-card',
      card: publishableCards[0],
    };
  }

  for (const card of matchingCards) {
    for (const reason of card.rejectionReasons || []) noReasons.add(reason);
    if (card.neighborConflict) noReasons.add('neighbor-conflict');
    if (card.nearbyImageCandidates !== 1) noReasons.add('image-not-unique-or-missing');
  }

  if (!matchingCards.length) noReasons.add('no-nearby-layout-card');
  if (candidate.exclusionReason) noReasons.add(candidate.exclusionReason);

  return {
    publishable: false,
    confidence: matchingCards[0]?.confidence || 0,
    reason: [...noReasons].join(',') || 'low-confidence',
    card: matchingCards[0] || null,
  };
}

function isProductionSafeLayoutCard(card = {}) {
  if (!card.publishable) return false;
  const title = normalizeKey(card.title || '');
  const raw = normalizeKey(card.rawZoneText || '');

  if (!title || title.split(' ').length < 2) return false;
  if (/(angebote gueltig|bio mehl|fett absolut|frei|mindestens|monats sparer|monatsparer|versch sorten|vorratspackungen)/.test(title)) return false;
  if (/^(?:aus|bis|fett|und|oder|per|statt|zur)\b/.test(title)) return false;
  if (/(mengenvorteil|stattpreise|verkaufspreise|nicht jeder artikel|angebote gueltig|gutschein)/.test(raw)) return false;
  if ((card.priceTokenCount || 0) > 2) return false;
  if ((card.quantityTokenCount || 0) > 2) return false;
  if (card.neighborConflict || (card.competingPriceAnchors || 0) > 0) return false;

  return false;
}

async function analyzeSource(source) {
  const maxPages = Number(source.crawlPolicy?.maxPdfPages || 6);
  const fetched = await fetchBuffer(source.sourceUrl);
  await fs.mkdir(OUT_DIR, { recursive: true });
  const safeName = `${source.retailerKey}-${source.sourceRetailerFormat}-${String(source.label || '').replace(/[^a-z0-9]+/gi, '-').slice(0, 50)}.pdf`;
  const pdfPath = path.join(OUT_DIR, safeName);
  await fs.writeFile(pdfPath, fetched.buffer);

  const pages = await parseTextPages(fetched.buffer, maxPages);
  const detectedValidity = extractOfficialFlyerValidityFromPages(pages, {
    contextYear: buildValidityFromSource(source).validTo?.getUTCFullYear?.() || 2026,
  });
  const validity = detectedValidity.validTo
    ? { ...detectedValidity, confidence: detectedValidity.validityConfidence }
    : buildValidityFromSource(source);
  const candidates = extractSparPdfCandidates({
    pages,
    sourceRetailerFormat: source.sourceRetailerFormat,
    validity,
  });
  const offers = normalizeSparPdfCandidatesToOffers({
    pdfReference: pdfReferenceFor({ source, pages, candidates, validity }),
    source: sourceForNormalize(source),
    crawlJobId: 'readonly-rejection-recovery-diagnostic',
    region: 'Grossraum Graz',
    pdfUrl: fetched.finalUrl || source.sourceUrl,
  });

  const [pdfjsPages, pymupdf] = await Promise.all([
    extractPdfjsPages(fetched.buffer, maxPages),
    extractPyMuPdfPages(pdfPath, maxPages),
  ]);
  const pymupdfByPage = new Map((pymupdf.pages || []).map((page) => [page.pageNumber, page]));
  const cardRows = [];

  for (const page of pdfjsPages) {
    const imageItems = pymupdfByPage.get(page.pageNumber)?.images || [];
    cardRows.push(...buildOfferCardDiagnostics({
      pageNumber: page.pageNumber,
      sourceKey: source.sourceKey || source.sourceRetailerFormat,
      sourceRetailerFormat: source.sourceRetailerFormat,
      textItems: page.textItems,
      imageItems,
    }));
  }

  const rejected = candidates.filter((candidate) => candidate.exclusionReason);
  const rejectionRows = rejected.map((candidate) => {
    const page = pages.find((item) => item.pageNumber === candidate.page);
    const cards = cardRows.filter((card) => Number(card.page) === Number(candidate.page));
    const recovery = recoverabilityFor({ candidate, cards });
    const pymupdfPage = pymupdfByPage.get(candidate.page) || {};

    return {
      sourceKey: source.sourceKey || `${source.sourceRetailerFormat}-official-flyer-pdf`,
      retailerKey: source.retailerKey,
      retailerName: source.retailerName,
      pdfUrl: source.sourceUrl,
      finalUrl: fetched.finalUrl,
      page: candidate.page,
      oldParserStatus: 'rejected',
      rejectionReason: candidate.exclusionReason,
      rejectionBucket: rejectionBucket(candidate.exclusionReason),
      visiblePriceAnchors: cards.length,
      nearbyImageCandidates: pymupdfPage.imageCount || 0,
      candidateTitleText: candidate.title || '',
      candidateQuantity: candidate.quantityText || '',
      candidateCondition: candidate.conditionsText || '',
      candidateValidity: {
        validFrom: safeIso(validity.validFrom),
        validTo: safeIso(validity.validTo),
        validityText: validity.validityText || '',
        confidence: validity.confidence || validity.validityConfidence || 0,
      },
      nearbyPriceTokens: candidatePriceTokens(candidate),
      nearbyQuantityTokens: candidateQuantityTokens(candidate),
      neighboringPriceConflict: Boolean(recovery.card?.neighborConflict),
      confidenceScore: recovery.confidence,
      publishable: recovery.publishable,
      ifNoExactReason: recovery.publishable ? '' : recovery.reason,
      toolOutput: {
        pdfParseSnippet: sanitize(candidate.rawText || '').slice(0, 500),
        pdfjsBestCard: recovery.card ? {
          title: recovery.card.title,
          quantity: recovery.card.quantity,
          condition: recovery.card.condition,
          price: recovery.card.anchor?.amount,
          confidence: recovery.card.confidence,
          decision: recovery.card.decision,
          rawZoneText: sanitize(recovery.card.rawZoneText || '').slice(0, 500),
        } : null,
        pymupdfPage: {
          wordCount: pymupdfPage.wordCount || 0,
          blockCount: pymupdfPage.blockCount || 0,
          imageCount: pymupdfPage.imageCount || 0,
        },
      },
      pageTextSnippet: sanitize(page?.text || '').slice(0, 700),
    };
  });

  const directCardPublishable = cardRows.filter((card) => card.publishable);
  const existingOfferKeys = new Set(offers.map((offer) => normalizeKey(`${offer.title} ${offer.priceCurrent?.amount} ${offer.quantityText}`)));
  const safeNewCardCandidates = directCardPublishable
    .filter((card) => isProductionSafeLayoutCard(card))
    .filter((card) => !existingOfferKeys.has(normalizeKey(`${card.title} ${card.anchor?.amount} ${card.quantity}`)))
    .map((card) => ({
      page: card.page,
      title: card.title,
      price: card.anchor?.amount,
      quantity: card.quantity,
      condition: card.condition,
      confidence: card.confidence,
      rejectionReasons: card.rejectionReasons,
      rawZoneText: sanitize(card.rawZoneText || '').slice(0, 500),
      imagePublishable: card.imagePublishable,
      imagePublishReason: card.imagePublishReason,
    }));

  return {
    source: {
      label: source.label,
      sourceKey: source.sourceKey || `${source.sourceRetailerFormat}-official-flyer-pdf`,
      retailerKey: source.retailerKey,
      sourceRetailerFormat: source.sourceRetailerFormat,
      pdfUrl: source.sourceUrl,
      finalUrl: fetched.finalUrl,
      httpStatus: fetched.status,
      contentType: fetched.contentType,
      maxPages,
    },
    counts: {
      pages: pages.length,
      pdfParseChars: pages.reduce((sum, page) => sum + page.charCount, 0),
      pdfjsTextItems: pdfjsPages.reduce((sum, page) => sum + page.itemCount, 0),
      pymupdfWords: (pymupdf.pages || []).reduce((sum, page) => sum + page.wordCount, 0),
      pymupdfBlocks: (pymupdf.pages || []).reduce((sum, page) => sum + page.blockCount, 0),
      pymupdfImages: (pymupdf.pages || []).reduce((sum, page) => sum + page.imageCount, 0),
      candidates: candidates.length,
      stored: offers.length,
      rejected: rejected.length,
      layoutCards: cardRows.length,
      directCardPublishable: directCardPublishable.length,
      safeNewCardCandidates: safeNewCardCandidates.length,
    },
    validity: {
      validFrom: safeIso(validity.validFrom),
      validTo: safeIso(validity.validTo),
      validityText: validity.validityText || '',
      confidence: validity.confidence || validity.validityConfidence || 0,
    },
    parserRejections: summarizeRejections(candidates),
    bucketRejections: countBy(rejectionRows, 'rejectionBucket'),
    pymupdf: {
      ok: pymupdf.ok,
      error: pymupdf.error || '',
    },
    rejectionRows,
    safeNewCardCandidates,
    rejectedSamples: buildRejectedCandidateSamples({
      candidates,
      sourceKey: source.sourceKey || `${source.sourceRetailerFormat}-official-flyer-pdf`,
      retailerKey: source.retailerKey,
      validityContext: validity.validityText || '',
      maxSamplesPerSourceReason: 3,
      maxSnippetLength: 260,
    }),
  };
}

function normalizeKey(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function countBy(rows = [], key) {
  const counts = {};
  for (const row of rows) {
    const value = row[key] || '';
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

function mergeCounts(sourceReports = [], selector) {
  const counts = {};
  for (const report of sourceReports) {
    const sourceCounts = selector(report) || {};
    if (Array.isArray(sourceCounts)) {
      for (const entry of sourceCounts) counts[entry.reason] = (counts[entry.reason] || 0) + entry.count;
    } else {
      for (const [key, value] of Object.entries(sourceCounts)) counts[key] = (counts[key] || 0) + value;
    }
  }
  return counts;
}

function summarizeRootCauses(rejectionRows = []) {
  const buckets = {};
  for (const row of rejectionRows) {
    if (!buckets[row.rejectionBucket]) {
      buckets[row.rejectionBucket] = {
        total: 0,
        publishable: 0,
        neighborConflict: 0,
        titleMissing: 0,
        quantityMissing: 0,
        lowConfidence: 0,
        imageUnsafe: 0,
      };
    }
    const bucket = buckets[row.rejectionBucket];
    bucket.total += 1;
    if (row.publishable) bucket.publishable += 1;
    if (row.neighboringPriceConflict) bucket.neighborConflict += 1;
    if (/title-missing/.test(row.ifNoExactReason)) bucket.titleMissing += 1;
    if (/quantity-missing/.test(row.ifNoExactReason)) bucket.quantityMissing += 1;
    if (/low-confidence|product-unclear|fragment/.test(row.ifNoExactReason)) bucket.lowConfidence += 1;
    if ((row.nearbyImageCandidates || 0) !== 1) bucket.imageUnsafe += 1;
  }
  return buckets;
}

async function inspectIPaper() {
  const urls = [
    'https://www.spar.at/aktionen',
    'https://www.spar.at/aktionen/steiermark',
    'https://www.spar.at/aktionen/steiermark/eurospar',
    'https://www.spar.at/aktionen/steiermark/interspar',
    'https://www.interspar.at/aktionen',
    'https://www.interspar.at/aktionen/steiermark',
    'https://flugblatt.spar.at/steiermark/spar/260603-1-flugblatt-kw-23/',
    'https://flugblatt.spar.at/steiermark/eurospar/260603-1-flugblatt-kw-23/',
    'https://flugblatt.interspar.at/steiermark/steiermark_kw23/',
  ];
  const rows = [];

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'text/html,application/json,*/*;q=0.8',
          'User-Agent': 'kaufklug-readonly-ipaper-inspection/1.0',
        },
      });
      const text = await response.text();
      rows.push({
        url,
        status: response.status,
        contentType: response.headers.get('content-type') || '',
        bytes: text.length,
        hasIPaper: /ipaper/i.test(text),
        hasManifest: /manifest|publication|paper|pages/i.test(text),
        hasProductHints: /hotspot|product|sku|article|warenkorb|price|preis/i.test(text),
        sampleLinks: [...text.matchAll(/https?:\/\/[^"'<> ]+/g)].map((match) => match[0]).filter((link) => /ipaper|pdf|json|manifest|page/i.test(link)).slice(0, 12),
        decision: /hotspot|sku|article/i.test(text)
          ? 'needs-manual-review-structured-hints-present'
          : 'no-usable-product-structure-found',
      });
    } catch (error) {
      rows.push({ url, status: 0, error: error.message || String(error), decision: 'fetch-failed-no-bypass' });
    }
  }

  return rows;
}

function markdownTable(rows, columns) {
  const lines = [
    `| ${columns.map((column) => column.label).join(' |')} |`,
    `| ${columns.map(() => '---').join(' |')} |`,
  ];
  for (const row of rows) {
    lines.push(`| ${columns.map((column) => sanitize(column.value(row)).replace(/\|/g, '/')).join(' |')} |`);
  }
  return lines.join('\n');
}

function buildMarkdown(report) {
  const lines = [];
  lines.push('# SPAR PDF Rejection Recovery Benchmark');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Read-only: ${report.safety.readOnly}`);
  lines.push('');
  lines.push('## Summary');
  lines.push(markdownTable([report.summary], [
    { label: 'raw', value: (row) => row.raw },
    { label: 'stored', value: (row) => row.stored },
    { label: 'rejected', value: (row) => row.rejected },
    { label: 'layout cards', value: (row) => row.layoutCards },
    { label: 'safe new cards', value: (row) => row.safeNewCardCandidates },
    { label: 'with images', value: (row) => row.withImage },
  ]));
  lines.push('');
  lines.push('## Sources');
  lines.push(markdownTable(report.sources.map((source) => ({ ...source.source, ...source.counts })), [
    { label: 'source', value: (row) => row.label },
    { label: 'retailer', value: (row) => row.retailerKey },
    { label: 'raw', value: (row) => row.candidates },
    { label: 'stored', value: (row) => row.stored },
    { label: 'rejected', value: (row) => row.rejected },
    { label: 'pdfjs items', value: (row) => row.pdfjsTextItems },
    { label: 'fitz words', value: (row) => row.pymupdfWords },
    { label: 'images', value: (row) => row.pymupdfImages },
    { label: 'safe new', value: (row) => row.safeNewCardCandidates },
  ]));
  lines.push('');
  lines.push('## Rejection Buckets');
  lines.push(markdownTable(Object.entries(report.rejectionBuckets).map(([reason, count]) => ({ reason, count })), [
    { label: 'reason', value: (row) => row.reason },
    { label: 'count', value: (row) => row.count },
  ]));
  lines.push('');
  lines.push('## Representative Non-Recoverable Samples');
  lines.push(markdownTable(report.nonRecoverableExamples.slice(0, 80), [
    { label: 'bucket', value: (row) => row.rejectionBucket },
    { label: 'source', value: (row) => row.sourceKey },
    { label: 'page', value: (row) => row.page },
    { label: 'reason', value: (row) => row.ifNoExactReason },
    { label: 'snippet', value: (row) => row.toolOutput?.pdfParseSnippet },
  ]));
  lines.push('');
  lines.push('## iPaper');
  lines.push(markdownTable(report.ipaper, [
    { label: 'url', value: (row) => row.url },
    { label: 'status', value: (row) => row.status },
    { label: 'hints', value: (row) => `ipaper=${row.hasIPaper} manifest=${row.hasManifest} product=${row.hasProductHints}` },
    { label: 'decision', value: (row) => row.decision },
  ]));
  lines.push('');
  return lines.join('\n');
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const sources = activeSparPdfSources();
  const sourceReports = [];

  for (const source of sources) {
    sourceReports.push(await analyzeSource(source));
  }

  const rejectionRows = sourceReports.flatMap((report) => report.rejectionRows);
  const safeNewCards = sourceReports.flatMap((report) => report.safeNewCardCandidates.map((card) => ({
    ...card,
    sourceKey: report.source.sourceKey,
    retailerKey: report.source.retailerKey,
    pdfUrl: report.source.pdfUrl,
  })));
  const ipaper = await inspectIPaper();
  const summary = {
    raw: sourceReports.reduce((sum, report) => sum + report.counts.candidates, 0),
    stored: sourceReports.reduce((sum, report) => sum + report.counts.stored, 0),
    materializedRejected: sourceReports.reduce((sum, report) => sum + report.counts.rejected, 0),
    rejected: 0,
    layoutCards: sourceReports.reduce((sum, report) => sum + report.counts.layoutCards, 0),
    directCardPublishable: sourceReports.reduce((sum, report) => sum + report.counts.directCardPublishable, 0),
    safeNewCardCandidates: safeNewCards.length,
    withImage: 0,
    missingImage: sourceReports.reduce((sum, report) => sum + report.counts.stored, 0),
  };
  summary.parseFailed = Math.max(0, summary.raw - summary.stored - summary.materializedRejected);
  summary.rejected = summary.materializedRejected + summary.parseFailed;
  const rejectionBuckets = mergeCounts(sourceReports, (reportItem) => reportItem.bucketRejections);
  if (summary.parseFailed) rejectionBuckets['parse-failed'] = (rejectionBuckets['parse-failed'] || 0) + summary.parseFailed;
  const rootCauses = summarizeRootCauses(rejectionRows);
  if (summary.parseFailed) {
    rootCauses['parse-failed'] = {
      total: summary.parseFailed,
      publishable: 0,
      neighborConflict: 0,
      titleMissing: 0,
      quantityMissing: 0,
      lowConfidence: summary.parseFailed,
      imageUnsafe: summary.parseFailed,
      mainReason: 'raw candidate was not materialized as a safe parser candidate; page zones remain mixed or below product-safety threshold',
    };
  }
  const report = {
    generatedAt: new Date().toISOString(),
    safety: {
      readOnly: true,
      fullCrawl: false,
      repair: false,
      reindex: false,
      rawMongoMutation: false,
      secretsOutput: false,
    },
    summary,
    parserRejections: mergeCounts(sourceReports, (reportItem) => reportItem.parserRejections),
    rejectionBuckets,
    rootCauses,
    safeNewCards,
    nonRecoverableExamples: rejectionRows.filter((row) => !row.publishable),
    recoverableExamples: rejectionRows.filter((row) => row.publishable),
    sources: sourceReports.map((reportItem) => ({
      source: reportItem.source,
      counts: reportItem.counts,
      validity: reportItem.validity,
      parserRejections: reportItem.parserRejections,
      bucketRejections: reportItem.bucketRejections,
      pymupdf: reportItem.pymupdf,
    })),
    ipaper,
  };

  await fs.writeFile(REPORT_JSON, JSON.stringify(report, null, 2), 'utf8');
  await fs.writeFile(REPORT_MD, buildMarkdown(report), 'utf8');
  console.log(JSON.stringify({
    ok: true,
    reportJson: REPORT_JSON,
    reportMarkdown: REPORT_MD,
    summary,
    rejectionBuckets: report.rejectionBuckets,
    rootCauses: report.rootCauses,
    safeNewCardCandidates: safeNewCards.length,
    recoverableRejections: report.recoverableExamples.length,
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      readOnly: true,
      error: error.message || String(error),
    }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = {
  REPORT_JSON,
  REPORT_MD,
  activeSparPdfSources,
  rejectionBucket,
};
