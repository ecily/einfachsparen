const assert = require('node:assert/strict');
const test = require('node:test');
const { Types } = require('mongoose');

const { __private } = require('../src/services/crawl/officialSourceCrawler');

function currentSource(overrides = {}) {
  const retailerFormat = overrides.sourceRetailerFormat || 'spar';
  return {
    _id: new Types.ObjectId(),
    retailerKey: retailerFormat,
    retailerName: retailerFormat.toUpperCase(),
    channel: 'official-flyer',
    sourceUrl: `https://www.${retailerFormat === 'interspar' ? 'interspar' : 'spar'}.at/aktionen/steiermark`,
    sourceType: 'flyer',
    parserHint: 'spar-family-flyer-discovery',
    sourceRetailerFormat: retailerFormat,
    regionScope: 'Steiermark',
    crawlPolicy: {
      currentDiscovery: true,
      currentSnapshot: true,
    },
    ...overrides,
  };
}

test('strict SPAR-family HTML allowlist rejects PDF assets and foreign redirects', () => {
  assert.equal(__private.isAllowedSparFamilyPublicHtmlUrl('https://www.spar.at/aktionen/steiermark'), true);
  assert.equal(__private.isAllowedSparFamilyPublicHtmlUrl('https://flugblatt.spar.at/steiermark/spar/260903-1-flugblatt-kw-36/'), true);
  assert.equal(__private.isAllowedSparFamilyPublicHtmlUrl('https://flugblatt.spar.at/steiermark/spar/260903-1-flugblatt-kw-36/getPdf.ashx'), false);
  assert.equal(__private.isAllowedSparFamilyPublicHtmlUrl('https://example.test/steiermark/spar/260903-1-flugblatt-kw-36/'), false);
});

test('multi-link production scope is enabled only for SPAR-family Steiermark current sources', () => {
  assert.equal(__private.isSparFamilyMultiLinkCurrentSource(currentSource({
    sourceRetailerFormat: 'spar',
  }), 'spar-official-flyer-current'), true);

  assert.equal(__private.isSparFamilyMultiLinkCurrentSource(currentSource({
    sourceRetailerFormat: 'interspar',
  }), 'interspar-official-flyer-current'), true);

  assert.equal(__private.isSparFamilyMultiLinkCurrentSource(currentSource({
    retailerKey: 'eurospar',
    sourceRetailerFormat: 'eurospar',
  }), 'eurospar-official-flyer-current'), true);

  assert.equal(__private.isSparFamilyMultiLinkCurrentSource(currentSource({
    sourceRetailerFormat: 'spar',
    regionScope: 'Wien',
    sourceUrl: 'https://www.spar.at/aktionen/wien',
    crawlPolicy: {
      currentDiscovery: true,
      currentSnapshot: true,
      entryPoints: ['https://www.spar.at/aktionen/wien'],
    },
  }), 'spar-official-flyer-current'), false);
});

test('SPAR multi-link selection keeps regular, enjoy and vetted fresh links but excludes other medium or high risk folders', () => {
  const source = currentSource({ sourceRetailerFormat: 'spar' });
  const links = [
    {
      url: 'https://flugblatt.spar.at/steiermark/spar/260903-1-flugblatt-kw-36/',
      kind: 'viewer',
      sourceGuess: 'spar',
      folderType: 'regular flyer',
    },
    {
      url: 'https://flugblatt.spar.at/steiermark/spar/260831-1-obst-gemuse-kw-36/',
      kind: 'viewer',
      sourceGuess: 'spar',
      folderType: 'grocery/fresh',
    },
    {
      url: 'https://flugblatt.spar.at/steiermark/spar/260903-2-spar-enjoy-kw-36/',
      kind: 'viewer',
      sourceGuess: 'spar',
      folderType: 'enjoy',
    },
    {
      url: 'https://flugblatt.spar.at/sonderfolder/mein-zuhause',
      kind: 'pdf',
      sourceGuess: 'spar',
      folderType: 'household/non-food',
    },
    {
      url: 'https://flugblatt.spar.at/steiermark/eurospar/kw26',
      kind: 'viewer',
      sourceGuess: 'eurospar',
      folderType: 'regular flyer',
    },
  ];

  const selected = __private.selectSparFamilyMultiLinkCurrentLinks(links, source);

  assert.deepEqual(selected.map((link) => link.url), [
    'https://flugblatt.spar.at/steiermark/spar/260903-1-flugblatt-kw-36/',
    'https://flugblatt.spar.at/steiermark/spar/260831-1-obst-gemuse-kw-36/',
    'https://flugblatt.spar.at/steiermark/spar/260903-2-spar-enjoy-kw-36/',
  ]);
});

test('SPAR current discovery ignores stale DB asset fallbacks', () => {
  const source = currentSource({
    sourceRetailerFormat: 'spar',
    crawlPolicy: {
      currentDiscovery: true,
      currentSnapshot: true,
      fallbackViewerUrls: ['https://flugblatt.spar.at/steiermark/spar/260618-1-flugblatt-kw-25/getPdf.ashx'],
    },
  });

  const merged = __private.mergeCurrentFallbackViewerUrls(source, 'spar-official-flyer-current');

  assert.deepEqual(merged, []);
});

test('current discovery remains fallback-free for legacy DB source shapes', () => {
  const sparSource = currentSource({
    retailerKey: 'spar',
    crawlPolicy: {
      currentDiscovery: true,
      currentSnapshot: true,
      fallbackViewerUrls: [],
    },
  });
  delete sparSource.sourceRetailerFormat;
  delete sparSource.regionScope;
  const intersparSource = currentSource({
    retailerKey: 'interspar',
    sourceUrl: 'https://www.interspar.at/aktionen/steiermark',
    crawlPolicy: {
      currentDiscovery: true,
      currentSnapshot: true,
      fallbackViewerUrls: [],
    },
  });
  delete intersparSource.sourceRetailerFormat;
  delete intersparSource.regionScope;

  assert.deepEqual(__private.mergeCurrentFallbackViewerUrls(sparSource, 'spar-official-flyer-current'), []);
  assert.deepEqual(__private.mergeCurrentFallbackViewerUrls(intersparSource, 'interspar-official-flyer-current'), []);
});

test('EUROSPAR selection accepts only its current public main viewer', () => {
  const source = currentSource({
    retailerKey: 'eurospar',
    sourceRetailerFormat: 'eurospar',
    crawlPolicy: {
      currentDiscovery: true,
      currentSnapshot: true,
      allowedFlyerKinds: ['viewer'],
    },
  });
  const selected = __private.selectSparFamilyMultiLinkCurrentLinks([
    {
      url: 'https://flugblatt.spar.at/steiermark/eurospar/260827-1-flugblatt-kw-35/',
      kind: 'viewer',
      sourceGuess: 'eurospar',
      folderType: 'regular flyer',
    },
    {
      url: 'https://flugblatt.spar.at/steiermark/eurospar/260827-1-flugblatt-kw-35/getPdf.ashx',
      kind: 'pdf',
      sourceGuess: 'eurospar',
      folderType: 'regular flyer',
    },
  ], source);

  assert.deepEqual(selected.map((link) => link.url), [
    'https://flugblatt.spar.at/steiermark/eurospar/260827-1-flugblatt-kw-35/',
  ]);
});

test('INTERSPAR multi-link selection keeps regular online flyer links and excludes wine or nonfood folders', () => {
  const source = currentSource({ sourceRetailerFormat: 'interspar' });
  const links = [
    {
      url: 'https://flugblatt.interspar.at/steiermark/steiermark_kw26',
      kind: 'viewer',
      sourceGuess: 'interspar',
      folderType: 'regular flyer',
    },
    {
      url: 'https://flugblatt.interspar.at/weinwelt/kw26',
      kind: 'viewer',
      sourceGuess: 'interspar',
      folderType: 'wine',
    },
    {
      url: 'https://flugblatt.interspar.at/sonderfolder/mein-zuhause',
      kind: 'pdf',
      sourceGuess: 'interspar',
      folderType: 'household/non-food',
    },
  ];

  const selected = __private.selectSparFamilyMultiLinkCurrentLinks(links, source);

  assert.deepEqual(selected.map((link) => link.url), [
    'https://flugblatt.interspar.at/steiermark/steiermark_kw26',
  ]);
});

test('multi-link stop reasons are exposed as crawl rejection reasons', () => {
  assert.deepEqual(__private.buildMultiLinkStopRejectionReasons([
    'zero-parsed-offers',
    'coverage-drop',
    'fragment-heavy',
  ]), [
    { reason: 'multi-link-zero-parsed-offers', count: 1 },
    { reason: 'multi-link-coverage-drop', count: 1 },
    { reason: 'multi-link-fragment-heavy', count: 1 },
  ]);
});
