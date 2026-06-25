const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');
const officialActionIndexLinks = require('./fixtures/spar-official-action-index-links.json');

const {
  deriveSourceKey,
} = require('../src/services/crawl/crawlSourceSelection');
const {
  buildSparFamilyActionIndexMatrix,
  buildFallbackViewerLinks,
  buildSparFamilyFlyerInventoryReport,
  classifySparFamilyActionIndexLink,
  classifySparFamilyFlyerUrl,
  classifySparFamilyPdfUrl,
  discoverSparFamilyFlyers,
  extractSparFamilyPdfLinksFromHtml,
  extractSparFamilyViewerLinksFromHtml,
  getBackendSparFamilyPdfSources,
  inferFolderType,
  isCurrentFallbackViewerUrl,
  isOfficialSparFamilyViewerUrl,
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

test('extracts current official action-index PDF hrefs from HTML without live access', () => {
  const html = `
    <a href="https://flugblatt.spar.at/steiermark/spar/260625-1-flugblatt-kw-26/getPdf.ashx">SPAR Flugblatt KW 26</a>
    <a href="https://flugblatt.spar.at/steiermark/spar/260625-2-spar-enjoy-kw-26/getPdf.ashx">SPAR enjoy KW 26</a>
    <a href="https://flugblatt.spar.at/wien/spar/260625-3-asia-kw26/getPdf.ashx">SPAR Asia KW26</a>
    <a href="https://flugblatt.spar.at/steiermark/spar/260622-1-obst-gemuse-kw-26/getPdf.ashx">SPAR Obst &amp; Gemuese KW 26</a>
    <a href="https://flugblatt.spar.at/steiermark/eurospar/260618-1-flugblatt-kw-25/getPdf.ashx">EUROSPAR Flugblatt KW 25</a>
    <a href="https://flugblatt.spar.at/steiermark/eurospar/260618-2-eiinleger-kw-25/getPdf.ashx">EUROSPAR Einleger KW 25</a>
    <a href="https://flugblatt.interspar.at/steiermark/steiermark_kw26/getPdf.ashx">INTERSPAR Online-Flugblatt Steiermark KW 26</a>
    <a href="https://flugblatt.interspar.at/steiermark/steiermark_kw25/getPdf.ashx">INTERSPAR Online-Flugblatt Steiermark KW 25</a>
  `;

  const links = extractSparFamilyPdfLinksFromHtml(html, {
    baseUrl: 'https://www.spar.at/aktionen/steiermark',
    discoveredFrom: 'fixture-official-action-index',
    maxLinks: 20,
    relevantOnly: false,
  });

  assert.deepEqual(links.map((link) => link.url), [
    'https://flugblatt.spar.at/steiermark/spar/260625-1-flugblatt-kw-26/getPdf.ashx',
    'https://flugblatt.spar.at/steiermark/spar/260625-2-spar-enjoy-kw-26/getPdf.ashx',
    'https://flugblatt.spar.at/wien/spar/260625-3-asia-kw26/getPdf.ashx',
    'https://flugblatt.spar.at/steiermark/spar/260622-1-obst-gemuse-kw-26/getPdf.ashx',
    'https://flugblatt.spar.at/steiermark/eurospar/260618-1-flugblatt-kw-25/getPdf.ashx',
    'https://flugblatt.spar.at/steiermark/eurospar/260618-2-eiinleger-kw-25/getPdf.ashx',
    'https://flugblatt.interspar.at/steiermark/steiermark_kw26/getPdf.ashx',
    'https://flugblatt.interspar.at/steiermark/steiermark_kw25/getPdf.ashx',
  ]);
  assert.equal(links.every((link) => link.discoveredFrom === 'fixture-official-action-index'), true);
});

test('extracts and classifies official SPAR-family flyer viewer links', () => {
  const html = `
    <a href="https://flugblatt.spar.at/steiermark/spar/260611-1-flugblatt-kw-24/">SPAR KW24</a>
    <a href="/aktionen/steiermark/steiermark_kw24">INTERSPAR KW24</a>
    <a href="https://www.interspar.at/aktionen/steiermark/steiermark_kw24">INTERSPAR web</a>
    <a href="https://www.spar.at/produkte">ignored</a>
  `;

  const links = extractSparFamilyViewerLinksFromHtml(html, {
    baseUrl: 'https://www.interspar.at',
    discoveredFrom: 'fixture',
  });
  const urls = links.map((link) => link.url);

  assert.deepEqual(urls, [
    'https://flugblatt.spar.at/steiermark/spar/260611-1-flugblatt-kw-24/',
    'https://www.interspar.at/aktionen/steiermark/steiermark_kw24',
  ]);
  assert.equal(links.every((link) => link.kind === 'viewer'), true);
  assert.equal(isOfficialSparFamilyViewerUrl(urls[0]), true);
  assert.equal(classifySparFamilyFlyerUrl(urls[0]).sourceGuess, 'spar');
  assert.equal(classifySparFamilyFlyerUrl(urls[1]).sourceGuess, 'interspar');
  assert.equal(classifySparFamilyFlyerUrl(urls[1]).kind, 'viewer');
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
  assert.equal(inferFolderType('https://flugblatt.spar.at/steiermark/spar/260625-2-spar-enjoy-kw-26/getPdf.ashx'), 'enjoy');
  assert.equal(inferFolderType('https://flugblatt.spar.at/wien/spar/260625-3-asia-kw26/getPdf.ashx'), 'asia');
  assert.equal(inferFolderType('https://flugblatt.spar.at/steiermark/spar/260622-1-obst-gemuse-kw-26/getPdf.ashx'), 'grocery/fresh');
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

test('uses configured current PDF fallback when official entrypoint is blocked', async () => {
  const entrypointUrl = 'https://www.spar.at/aktionen/steiermark';
  const pdfUrl = 'https://flugblatt.spar.at/steiermark/spar/260618-1-flugblatt-kw-25/getPdf.ashx';
  const httpClient = createHttpClient({
    htmlByUrl: {
      [entrypointUrl]: '<html><title>Just a moment...</title><body>Cloudflare</body></html>',
    },
    statusByUrl: {
      [entrypointUrl]: 403,
    },
  });
  const metadataCalls = [];

  const result = await discoverSparFamilyFlyers({
    entryPoints: [entrypointUrl],
    fallbackViewerUrls: [pdfUrl],
    httpClient,
    pdfMetadataLoader: async (url) => {
      metadataCalls.push(url);
      return {
        fetchStatus: 'ok',
        httpStatus: 200,
        pageCount: 2,
        text: 'Do., 18.06.26 - Di., 30.06.26 Aperol Aktion',
        error: '',
      };
    },
    limits: { maxPdfMetadataLookups: 1 },
  });

  assert.deepEqual(httpClient.calls, [entrypointUrl]);
  assert.deepEqual(metadataCalls, [pdfUrl]);
  assert.equal(result.checkedPages[0].fetchStatus, 'blocked');
  assert.deepEqual(result.fallbackViewerUrls, [pdfUrl]);
  assert.equal(result.pdfs.length, 1);
  assert.equal(result.pdfs[0].url, pdfUrl);
  assert.equal(result.pdfs[0].kind, 'pdf');
  assert.equal(result.pdfs[0].sourceGuess, 'spar');
  assert.equal(result.pdfs[0].folderType, 'regular flyer');
  assert.equal(result.pdfs[0].fetchStatus, 'ok');
  assert.equal(result.pdfs[0].pageCount, 2);
  assert.equal(result.pdfs[0].containsValidityTerms, true);
});

test('ignores stale configured current fallbacks without fetching them', async () => {
  const entrypointUrl = 'https://www.spar.at/aktionen/steiermark';
  const historicalViewerUrl = 'https://flugblatt.spar.at/steiermark/spar/260611-1-flugblatt-kw-24/';
  const httpClient = createHttpClient({
    htmlByUrl: {
      [entrypointUrl]: '<html><title>Just a moment...</title><body>Cloudflare</body></html>',
      [historicalViewerUrl]: '<html></html>',
    },
    statusByUrl: {
      [entrypointUrl]: 403,
    },
  });

  const result = await discoverSparFamilyFlyers({
    entryPoints: [entrypointUrl],
    fallbackViewerUrls: [historicalViewerUrl],
    httpClient,
    limits: { maxPdfMetadataLookups: 1 },
  });

  assert.deepEqual(httpClient.calls, [entrypointUrl]);
  assert.deepEqual(result.fallbackViewerUrls, []);
  assert.equal(result.pdfs.length, 0);
});

test('only accepts current SPAR-family fallback URLs', () => {
  assert.equal(isCurrentFallbackViewerUrl('https://flugblatt.spar.at/steiermark/spar/260625-1-flugblatt-kw-26/getPdf.ashx'), true);
  assert.equal(isCurrentFallbackViewerUrl('https://flugblatt.spar.at/steiermark/spar/260622-1-obst-gemuse-kw-26/getPdf.ashx'), true);
  assert.equal(isCurrentFallbackViewerUrl('https://flugblatt.interspar.at/steiermark/steiermark_kw26/getPdf.ashx'), true);
  assert.equal(isCurrentFallbackViewerUrl('https://flugblatt.spar.at/steiermark/spar/260618-1-flugblatt-kw-25/getPdf.ashx'), true);
  assert.equal(isCurrentFallbackViewerUrl('https://flugblatt.spar.at/steiermark/spar/260618-1-flugblatt-kw-25/'), true);
  assert.equal(isCurrentFallbackViewerUrl('https://flugblatt.interspar.at/steiermark/steiermark_kw25/getPdf.ashx'), true);
  assert.equal(isCurrentFallbackViewerUrl('https://flugblatt.spar.at/steiermark/spar/260611-1-flugblatt-kw-24/getPdf.ashx'), false);
  assert.equal(isCurrentFallbackViewerUrl('https://flugblatt.interspar.at/steiermark/steiermark_kw24/'), false);
  assert.equal(isCurrentFallbackViewerUrl('https://example.test/steiermark/spar/260618-1-flugblatt-kw-25/getPdf.ashx'), false);
});

test('builds configured current fallback links for KW26 before stale DB fallbacks', () => {
  const links = buildFallbackViewerLinks([
    'https://flugblatt.spar.at/steiermark/spar/260625-1-flugblatt-kw-26/getPdf.ashx',
    'https://flugblatt.spar.at/steiermark/spar/260622-1-obst-gemuse-kw-26/getPdf.ashx',
    'https://flugblatt.spar.at/steiermark/spar/260618-1-flugblatt-kw-25/getPdf.ashx',
  ]);

  assert.deepEqual(links.map((link) => link.url), [
    'https://flugblatt.spar.at/steiermark/spar/260625-1-flugblatt-kw-26/getPdf.ashx',
    'https://flugblatt.spar.at/steiermark/spar/260622-1-obst-gemuse-kw-26/getPdf.ashx',
    'https://flugblatt.spar.at/steiermark/spar/260618-1-flugblatt-kw-25/getPdf.ashx',
  ]);
  assert.equal(links.every((link) => link.kind === 'pdf'), true);
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

test('SPAR-family PDF SourceDefinitions keep old static regular flyers scoped-only', () => {
  const sources = getBackendSparFamilyPdfSources(RETAILER_DEFINITIONS)
    .filter((source) => source.enabled);
  const urls = sources.map((source) => source.url);
  const oldRegularKw23 = sources.filter((source) => /260603-1-flugblatt-kw-23|steiermark_kw23/i.test(source.url));

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
  assert.equal(urls.includes('https://flugblatt.interspar.at/weinwelt/260511-4-weinwelt-bestseller-06-2026/getPdf.ashx'), true);
  assert.equal(urls.includes('https://flugblatt.interspar.at/sonderfolder/mein-zuhause-sommer26/getPdf.ashx'), true);
  assert.equal(urls.every(isOfficialSparFamilyPdfUrl), true);
  assert.equal(oldRegularKw23.length, 3);
  assert.equal(oldRegularKw23.every((source) => source.scopedOnly === true), true);
  assert.equal(oldRegularKw23.every((source) => source.currentSnapshot === false), true);
  assert.equal(sources.every((source) => source.scopedOnly === true), true);
  assert.equal(sources.every((source) => source.currentSnapshot === false), true);
  assert.equal(
    sources.some((source) => /260603-1-flugblatt-kw-23|steiermark_kw23/i.test(source.url)
      && source.scopedOnly !== true
      && source.currentSnapshot !== false),
    false
  );
});

test('active SPAR-family PDF definitions reject expired validity windows', () => {
  const now = new Date('2026-06-03T12:00:00.000Z');
  const sources = RETAILER_DEFINITIONS.filter((definition) => (
    definition.channel === 'official-flyer'
    && definition.sourceType === 'pdf'
    && /flugblatt\.(?:spar|interspar)\.at/i.test(definition.sourceUrl)
    && definition.enabled !== false
  ));

  assert.equal(sources.length, 15);
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
  assert.equal(byFormat.get('spar').scopedOnly, true);
  assert.equal(byFormat.get('eurospar').scopedOnly, true);
  assert.equal(byFormat.get('interspar').scopedOnly, true);
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

test('SPAR-family current flyer discovery definitions are registered without local or aggregator sources', () => {
  const currentSources = RETAILER_DEFINITIONS.filter((definition) => definition.parserHint === 'spar-family-flyer-discovery');

  assert.equal(currentSources.length, 3);
  assert.deepEqual(currentSources.map((source) => deriveSourceKey(source)).sort(), [
    'eurospar-official-flyer-current',
    'interspar-official-flyer-current',
    'spar-official-flyer-current',
  ]);
  assert.deepEqual(currentSources.map((source) => source.retailerKey).sort(), ['eurospar', 'interspar', 'spar']);
  assert.equal(currentSources.every((source) => source.channel === 'official-flyer'), true);
  assert.equal(currentSources.every((source) => source.sourceType === 'flyer'), true);
  assert.equal(currentSources.every((source) => source.enabled !== false), true);
  assert.equal(currentSources.every((source) => source.crawlPolicy?.scopedOnly === true), true);
  assert.equal(currentSources.every((source) => source.crawlPolicy?.currentDiscovery === true), true);
  assert.equal(currentSources.every((source) => source.crawlPolicy?.currentSnapshot === true), true);
  assert.equal(currentSources.every((source) => source.parserHint !== 'official-category-actions'), true);
  assert.equal(currentSources.every((source) => !/^(?:[A-Z]:\\|file:|https?:\/\/(?:www\.)?aktionsfinder\.at|https?:\/\/(?:www\.)?marktguru\.at)/i.test(source.sourceUrl)), true);
  const byKey = new Map(currentSources.map((source) => [deriveSourceKey(source), source]));
  assert.deepEqual(byKey.get('spar-official-flyer-current').crawlPolicy.fallbackViewerUrls, [
    'https://flugblatt.spar.at/steiermark/spar/260625-1-flugblatt-kw-26/getPdf.ashx',
    'https://flugblatt.spar.at/steiermark/spar/260622-1-obst-gemuse-kw-26/getPdf.ashx',
    'https://flugblatt.spar.at/steiermark/spar/260618-1-flugblatt-kw-25/getPdf.ashx',
  ]);
  assert.equal(byKey.get('spar-official-flyer-current').crawlPolicy.maxPdfPages, 24);
  assert.deepEqual(byKey.get('interspar-official-flyer-current').crawlPolicy.fallbackViewerUrls, [
    'https://flugblatt.interspar.at/steiermark/steiermark_kw26/getPdf.ashx',
    'https://flugblatt.interspar.at/steiermark/steiermark_kw25/getPdf.ashx',
  ]);
  assert.equal(byKey.get('interspar-official-flyer-current').crawlPolicy.maxPdfPages, 24);
  assert.equal(byKey.get('eurospar-official-flyer-current').crawlPolicy.fallbackViewerUrls, undefined);
});

test('classifies official SPAR-family action index links into diagnostic matrix fields', () => {
  const matrix = buildSparFamilyActionIndexMatrix(officialActionIndexLinks);
  const byFolder = new Map(matrix.map((row) => [`${row.retailerFormat}:${row.folderType}`, row]));

  assert.equal(matrix.length, officialActionIndexLinks.length);
  assert.equal(matrix.every((row) => row.url.startsWith('https://flugblatt.')), true);
  assert.equal(matrix.every((row) => row.urlClass && !row.urlClass.includes('?')), true);
  assert.equal(matrix.every((row) => row.reason && row.recommendedNextStep), true);
  assert.equal(matrix.every((row) => row.validity && Object.prototype.hasOwnProperty.call(row.validity, 'unknown')), true);

  for (const row of matrix) {
    assert.ok(['spar', 'eurospar', 'interspar', 'unknown'].includes(row.retailerFormat), row.url);
    assert.ok(['viewer', 'pdf', 'html', 'unknown'].includes(row.linkType), row.url);
    assert.ok(['steiermark', 'austria', 'unknown'].includes(row.region), row.url);
    assert.ok(['low', 'medium', 'high'].includes(row.risk), row.url);
    assert.ok(['supported-currently', 'partially-supported', 'unsupported', 'policy-bounded', 'public-disabled'].includes(row.kaufklugSupport), row.url);
  }

  assert.equal(byFolder.get('spar:main-flyer').risk, 'low');
  assert.equal(byFolder.get('spar:main-flyer').kaufklugSupport, 'supported-currently');
  assert.equal(byFolder.get('spar:enjoy').risk, 'medium');
  assert.equal(byFolder.get('spar:asia').risk, 'medium');
  assert.equal(byFolder.get('spar:fruit-vegetable').risk, 'medium');
  assert.equal(byFolder.get('spar:monatssparer').kaufklugSupport, 'partially-supported');
  assert.equal(byFolder.get('eurospar:main-flyer').risk, 'low');
  assert.equal(byFolder.get('eurospar:main-flyer').kaufklugSupport, 'public-disabled');
  assert.equal(byFolder.get('eurospar:insert/einleger').risk, 'medium');
  assert.equal(byFolder.get('interspar:online-flyer').risk, 'low');
  assert.equal(byFolder.get('interspar:online-flyer').kaufklugSupport, 'supported-currently');
  assert.equal(byFolder.get('interspar:school').risk, 'high');
  assert.equal(byFolder.get('interspar:partyservice').kaufklugSupport, 'unsupported');
  assert.equal(byFolder.get('interspar:wine').risk, 'high');
});

test('extracts action index validity from visible labels without fetching live pages', () => {
  const row = classifySparFamilyActionIndexLink({
    url: 'https://flugblatt.interspar.at/steiermark/steiermark_kw26/getPdf.ashx?tracking=ignored',
    label: 'INTERSPAR Online-Flugblatt Steiermark KW 26 Do., 25.06.26 - Di., 30.06.26 Zum Flugblatt',
    discoveredFrom: 'fixture',
  });

  assert.equal(row.url, 'https://flugblatt.interspar.at/steiermark/steiermark_kw26/getPdf.ashx?tracking=ignored');
  assert.equal(row.urlClass, 'https://flugblatt.interspar.at/steiermark/steiermark_kw26/getPdf.ashx');
  assert.equal(row.retailerFormat, 'interspar');
  assert.equal(row.folderType, 'online-flyer');
  assert.equal(row.region, 'steiermark');
  assert.equal(row.linkType, 'pdf');
  assert.deepEqual(row.validity, {
    validFrom: '2026-06-25',
    validTo: '2026-06-30',
    unknown: false,
  });
});

test('action index matrix keeps high-risk special folders diagnostic-only', () => {
  const matrix = buildSparFamilyActionIndexMatrix(officialActionIndexLinks);
  const highRiskRows = matrix.filter((row) => row.risk === 'high');

  assert.ok(highRiskRows.length >= 4);
  assert.equal(highRiskRows.every((row) => /diagnostic-only|not part of current productive|high-risk/i.test(`${row.recommendedNextStep} ${row.reason}`)), true);
  assert.equal(highRiskRows.some((row) => row.folderType === 'home/nonfood'), true);
  assert.equal(highRiskRows.some((row) => row.folderType === 'school'), true);
  assert.equal(highRiskRows.some((row) => row.folderType === 'partyservice'), true);
  assert.equal(highRiskRows.some((row) => row.folderType === 'wine'), true);
});
