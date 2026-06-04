const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');

const {
  buildSparFamilyFlyerInventoryReport,
  classifySparFamilyPdfUrl,
  discoverSparFamilyFlyers,
  extractSparFamilyPdfLinksFromHtml,
  getBackendSparFamilyPdfSources,
  inferFolderType,
  isOfficialSparFamilyPdfUrl,
} = require('../src/services/crawl/sparFamilyFlyerDiscovery');
const { RETAILER_DEFINITIONS } = require('../src/services/sources/sourceDefinitions');

function createHttpClient({ htmlByUrl = {}, statusByUrl = {} } = {}) {
  const calls = [];

  return {
    calls,
    async get(url) {
      calls.push(url);
      const status = statusByUrl[url] || 200;
      return {
        status,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        data: htmlByUrl[url] || '<html></html>',
        request: { res: { responseUrl: url } },
      };
    },
  };
}

test('extracts official getPdf links from HTML including escaped and relative URLs', () => {
  const html = `
    <a href="https://flugblatt.spar.at/steiermark/spar/kw22/getPdf.ashx?x=1&amp;y=2">SPAR</a>
    <script>
      window.asset = "https:\\/\\/flugblatt.interspar.at\\/sonderfolder\\/mein-zuhause-sommer26\\/getPdf.ashx";
    </script>
    <a href="/steiermark/eurospar/kw22/ViewPdf.ashx">EUROSPAR</a>
  `;

  const links = extractSparFamilyPdfLinksFromHtml(html, {
    baseUrl: 'https://flugblatt.spar.at/start',
    discoveredFrom: 'fixture',
  });

  assert.deepEqual(links.map((link) => link.url), [
    'https://flugblatt.spar.at/steiermark/spar/kw22/getPdf.ashx?x=1&y=2',
    'https://flugblatt.spar.at/steiermark/eurospar/kw22/getPdf.ashx',
    'https://flugblatt.interspar.at/sonderfolder/mein-zuhause-sommer26/getPdf.ashx',
  ]);
  assert.deepEqual(links.map((link) => link.discoveredFrom), ['fixture', 'fixture', 'fixture']);
});

test('dedupes duplicate PDF links', () => {
  const html = `
    <a href="https://flugblatt.spar.at/steiermark/spar/kw22/getPdf.ashx">A</a>
    <a href="https://flugblatt.spar.at/steiermark/spar/kw22/getPdf.ashx#page=1">B</a>
    https://flugblatt.spar.at/steiermark/spar/kw22/getPdf.ashx
  `;

  const links = extractSparFamilyPdfLinksFromHtml(html, {
    baseUrl: 'https://www.spar.at/aktionen/steiermark',
  });

  assert.equal(links.length, 1);
  assert.equal(links[0].url, 'https://flugblatt.spar.at/steiermark/spar/kw22/getPdf.ashx');
});

test('classifies SPAR-family source guesses conservatively', () => {
  assert.equal(classifySparFamilyPdfUrl('https://flugblatt.spar.at/steiermark/spar/kw22/getPdf.ashx').sourceGuess, 'spar');
  assert.equal(classifySparFamilyPdfUrl('https://flugblatt.spar.at/steiermark/eurospar/kw22/getPdf.ashx').sourceGuess, 'eurospar');
  assert.equal(classifySparFamilyPdfUrl('https://flugblatt.interspar.at/steiermark/kw22/getPdf.ashx').sourceGuess, 'interspar');
  assert.equal(classifySparFamilyPdfUrl('https://flugblatt.interspar.at/sonderfolder/mein-zuhause-sommer26/getPdf.ashx').sourceGuess, 'sonderfolder');
  assert.equal(classifySparFamilyPdfUrl('https://flugblatt.spar.at/weinwelt/sommer26/getPdf.ashx').sourceGuess, 'weinwelt');
  assert.equal(classifySparFamilyPdfUrl('https://flugblatt.spar.at/special/x/getPdf.ashx').sourceGuess, 'unknown');
  assert.equal(classifySparFamilyPdfUrl('https://example.test/steiermark/spar/getPdf.ashx').allowed, false);
});

test('infers folder types from safe URL and text heuristics', () => {
  assert.equal(inferFolderType('https://flugblatt.interspar.at/sonderfolder/mein-zuhause-sommer26/getPdf.ashx'), 'household/non-food');
  assert.equal(inferFolderType('https://flugblatt.spar.at/steiermark/spar/gutscheinheft/getPdf.ashx'), 'coupon booklet');
  assert.equal(inferFolderType('https://flugblatt.spar.at/steiermark/spar/frische/getPdf.ashx', 'Obst und Gemuese'), 'grocery/fresh');
  assert.equal(inferFolderType('https://flugblatt.spar.at/weinwelt/sommer26/getPdf.ashx'), 'wine');
  assert.equal(inferFolderType('https://flugblatt.spar.at/steiermark/spar/kw22/getPdf.ashx'), 'regular flyer');
});

test('models 403 or Cloudflare pages as blocked without extracting links', async () => {
  const httpClient = createHttpClient({
    htmlByUrl: {
      'https://www.spar.at/aktionen/steiermark/spar': '<html><title>Just a moment...</title><body>Cloudflare</body></html>',
    },
    statusByUrl: {
      'https://www.spar.at/aktionen/steiermark/spar': 403,
    },
  });

  const result = await discoverSparFamilyFlyers({
    entryPoints: ['https://www.spar.at/aktionen/steiermark/spar'],
    httpClient,
    pdfMetadataLoader: async () => {
      throw new Error('should not load PDF metadata');
    },
  });

  assert.equal(result.checkedPages[0].fetchStatus, 'blocked');
  assert.equal(result.checkedPages[0].blockedLikely, true);
  assert.equal(result.pdfs.length, 0);
});

test('enforces maxEntryPoints maxLinks and maxPdfMetadataLookups', async () => {
  const html = `
    <a href="https://flugblatt.spar.at/steiermark/spar/one/getPdf.ashx">one</a>
    <a href="https://flugblatt.spar.at/steiermark/eurospar/two/getPdf.ashx">two</a>
    <a href="https://flugblatt.interspar.at/sonderfolder/mein-zuhause-sommer26/getPdf.ashx">three</a>
  `;
  const httpClient = createHttpClient({
    htmlByUrl: {
      'https://www.spar.at/aktionen/steiermark': html,
      'https://www.spar.at/aktionen/steiermark/eurospar': html,
    },
  });
  const metadataCalls = [];

  const result = await discoverSparFamilyFlyers({
    entryPoints: [
      'https://www.spar.at/aktionen/steiermark',
      'https://www.spar.at/aktionen/steiermark/eurospar',
    ],
    httpClient,
    pdfMetadataLoader: async (url) => {
      metadataCalls.push(url);
      return {
        fetchStatus: 'ok',
        httpStatus: 200,
        pageCount: 40,
        text: 'Rowenta gueltig bis 17.6.',
        error: '',
      };
    },
    limits: {
      maxEntryPoints: 1,
      maxLinks: 2,
      maxPdfMetadataLookups: 1,
      defaultMaxPages: 6,
      sparFamilyMaxPages24: 24,
    },
  });

  assert.deepEqual(httpClient.calls, ['https://www.spar.at/aktionen/steiermark']);
  assert.equal(result.pdfs.length, 2);
  assert.equal(metadataCalls.length, 1);
  assert.equal(result.pdfs[0].pageCount, 40);
  assert.equal(result.pdfs[0].wouldExceedDefaultMaxPages, true);
  assert.equal(result.pdfs[0].wouldExceedSparFamilyMaxPages24, true);
  assert.equal(result.pdfs[0].containsNonFoodTerms, true);
  assert.equal(result.pdfs[0].containsValidityTerms, true);
  assert.equal(result.pdfs[1].fetchStatus, 'skipped');
});

test('report compares discovered PDFs with backend SourceDefinitions and does not include secrets', async () => {
  const previousSecret = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = 'secret-value-that-must-not-appear';

  try {
    const discovery = {
      generatedAt: '2026-05-30T12:00:00.000Z',
      limits: {},
      checkedPages: [],
      pdfs: [
        {
          url: 'https://flugblatt.spar.at/steiermark/spar/kw22/getPdf.ashx',
          sourceGuess: 'spar',
          folderType: 'regular flyer',
          containsNonFoodTerms: false,
          wouldExceedSparFamilyMaxPages24: false,
        },
        {
          url: 'https://flugblatt.interspar.at/sonderfolder/mein-zuhause-sommer26/getPdf.ashx',
          sourceGuess: 'sonderfolder',
          folderType: 'household/non-food',
          containsNonFoodTerms: true,
          wouldExceedSparFamilyMaxPages24: true,
        },
      ],
    };
    const backendSources = getBackendSparFamilyPdfSources([
      {
        retailerKey: 'spar',
        channel: 'official-flyer',
        sourceUrl: 'https://flugblatt.spar.at/steiermark/spar/kw22/getPdf.ashx',
        crawlPolicy: { maxPdfPages: 24 },
      },
    ]);
    const report = buildSparFamilyFlyerInventoryReport({ discovery, backendSources });
    const serialized = JSON.stringify(report);

    assert.equal(report.summary.discoveredPdfCount, 2);
    assert.deepEqual(report.missingInBackend.map((item) => item.url), [
      'https://flugblatt.interspar.at/sonderfolder/mein-zuhause-sommer26/getPdf.ashx',
    ]);
    assert.equal(serialized.includes(process.env.ADMIN_API_KEY), false);
  } finally {
    if (previousSecret === undefined) {
      delete process.env.ADMIN_API_KEY;
    } else {
      process.env.ADMIN_API_KEY = previousSecret;
    }
  }
});

test('discovery service does not open a MongoDB connection', async () => {
  const beforeState = mongoose.connection.readyState;
  const httpClient = createHttpClient({
    htmlByUrl: {
      'https://www.spar.at/aktionen/steiermark': '<a href="https://flugblatt.spar.at/steiermark/spar/kw22/getPdf.ashx">PDF</a>',
    },
  });

  await discoverSparFamilyFlyers({
    entryPoints: ['https://www.spar.at/aktionen/steiermark'],
    httpClient,
    limits: { maxPdfMetadataLookups: 0 },
  });

  assert.equal(mongoose.connection.readyState, beforeState);
  assert.equal(mongoose.connection.readyState, 0);
});

test('active SPAR-family PDF SourceDefinitions include current official multi-PDF URLs', () => {
  const sources = getBackendSparFamilyPdfSources(RETAILER_DEFINITIONS)
    .filter((source) => source.enabled);
  const urls = sources.map((source) => source.url);

  assert.deepEqual(
    sources.map((source) => source.sourceRetailerFormat).sort(),
    [
      'eurospar',
      'eurospar',
      'eurospar',
      'eurospar',
      'interspar',
      'interspar',
      'interspar',
      'interspar',
      'spar',
      'spar',
      'spar',
      'spar',
      'spar',
    ]
  );
  assert.equal(urls.includes('https://flugblatt.spar.at/steiermark/spar/260513-3-monatssparer-kw-20/getPdf.ashx'), true);
  assert.equal(urls.includes('https://flugblatt.spar.at/steiermark/spar/260513-2-grillen-kw-20/getPdf.ashx'), true);
  assert.equal(urls.includes('https://flugblatt.spar.at/steiermark/spar/260528-3-spar-gutscheinheft-kw-22/getPdf.ashx'), true);
  assert.equal(urls.includes('https://flugblatt.spar.at/steiermark/spar/260601-1-obst-gemuse-kw-23/getPdf.ashx'), true);
  assert.equal(urls.every(isOfficialSparFamilyPdfUrl), true);
});

test('active SPAR-family PDF definitions reject expired validity windows', () => {
  const now = new Date('2026-06-03T12:00:00.000Z');
  const sources = RETAILER_DEFINITIONS.filter((definition) => (
    definition.channel === 'official-flyer'
    && definition.sourceType === 'pdf'
    && /flugblatt\.(?:spar|interspar)\.at/i.test(definition.sourceUrl)
    && definition.enabled !== false
  ));

  assert.equal(sources.length, 13);
  assert.equal(
    sources.some((source) => new Date(source.crawlPolicy.validTo).getTime() <= now.getTime()),
    false
  );
});

test('SPAR-family PDF SourceDefinitions keep retailer formats separated and bounded', () => {
  const sources = getBackendSparFamilyPdfSources(RETAILER_DEFINITIONS)
    .filter((source) => source.enabled);
  const byFormat = new Map(
    sources
      .filter((source) => /260603-1-flugblatt-kw-23|steiermark_kw23/i.test(source.url))
      .map((source) => [source.sourceRetailerFormat, source])
  );

  assert.equal(byFormat.get('spar').retailerKey, 'spar');
  assert.equal(byFormat.get('eurospar').retailerKey, 'eurospar');
  assert.equal(byFormat.get('interspar').retailerKey, 'interspar');
  assert.equal(byFormat.get('spar').maxPdfPages, 28);
  assert.equal(byFormat.get('eurospar').maxPdfPages, 24);
  assert.equal(byFormat.get('interspar').maxPdfPages, 24);
  assert.ok(sources.every((source) => source.maxPdfBytes <= 62914560));
  assert.ok(sources.every((source) => source.timeoutMs <= 60000));
});

test('additional SPAR-family shared PDF definitions are scoped-only and coupon-safe', () => {
  const sharedSources = RETAILER_DEFINITIONS.filter((definition) => (
    definition.channel === 'official-flyer'
    && definition.sourceType === 'pdf'
    && /260513-3-monatssparer|260513-2-grillen|260528-3-spar-gutscheinheft/i.test(definition.sourceUrl)
  ));
  const couponSources = sharedSources.filter((definition) => /gutscheinheft/i.test(definition.sourceUrl));

  assert.equal(sharedSources.length, 9);
  assert.equal(sharedSources.every((source) => source.crawlPolicy?.scopedOnly === true), true);
  assert.equal(couponSources.length, 3);
  assert.equal(couponSources.every((source) => source.crawlPolicy?.requireCouponCondition === true), true);
});
