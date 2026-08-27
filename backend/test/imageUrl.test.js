const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildImageRequestHeaders,
  isUsableImageUrl,
  normalizeImageUrl,
  parseSrcsetCandidates,
} = require('../src/services/images/imageUrl');
const offerRouter = require('../src/routes/offer.routes');
const { isOfferFreshForActiveUse } = require('../src/services/offers/offerFreshness');

test('normalizes absolute, relative and srcset image URLs', () => {
  assert.equal(
    normalizeImageUrl('https://products.dm-static.com/images/f_auto,q_auto,c_fit,h_320,w_320/v1764283579/assets/pas/images/6315646d-9859-45c4-83f4-b7cc5a8f3141/penaten-baby-pflegecreme-gesicht-und-koerper-intensiv'),
    'https://products.dm-static.com/images/f_auto,q_auto,c_fit,h_320,w_320/v1764283579/assets/pas/images/6315646d-9859-45c4-83f4-b7cc5a8f3141/penaten-baby-pflegecreme-gesicht-und-koerper-intensiv'
  );
  assert.equal(
    normalizeImageUrl('https://www.billa.at/dam/jcr:test/product-image.png'),
    'https://www.billa.at/dam/jcr:test/product-image.png'
  );
  assert.equal(
    normalizeImageUrl('/dw/image/v2/AAFT_PRD/original/123.png?sw=140', 'https://www.bipa.at/cp/aktionen'),
    'https://www.bipa.at/dw/image/v2/AAFT_PRD/original/123.png?sw=140'
  );
  assert.equal(
    normalizeImageUrl('https://products.dm-static.com/image.png?sw=140 1x, https://products.dm-static.com/image.png?sw=280 2x'),
    'https://products.dm-static.com/image.png?sw=140'
  );
  assert.equal(normalizeImageUrl('not a url'), '');
});

test('parses image srcset candidates without density descriptors', () => {
  assert.deepEqual(
    parseSrcsetCandidates('https://example.test/a.png?sw=140 1x, /b.png?sw=280 2x'),
    ['https://example.test/a.png?sw=140', '/b.png?sw=280']
  );
  assert.deepEqual(
    parseSrcsetCandidates('https://example.test/a.png 320w, https://example.test/a.png?size=large 640w'),
    ['https://example.test/a.png', 'https://example.test/a.png?size=large']
  );
  assert.deepEqual(
    parseSrcsetCandidates('https://products.dm-static.com/images/f_auto,q_auto,c_fit,h_320,w_320/v1764283579/assets/pas/images/6315646d-9859-45c4-83f4-b7cc5a8f3141/penaten-baby-pflegecreme-gesicht-und-koerper-intensiv'),
    ['https://products.dm-static.com/images/f_auto,q_auto,c_fit,h_320,w_320/v1764283579/assets/pas/images/6315646d-9859-45c4-83f4-b7cc5a8f3141/penaten-baby-pflegecreme-gesicht-und-koerper-intensiv']
  );
});

test('checks usable public image URLs', () => {
  assert.equal(isUsableImageUrl('https://www.bipa.at/image.png'), true);
  assert.equal(isUsableImageUrl('/image.png'), false);
  assert.equal(isUsableImageUrl('javascript:alert(1)'), false);
});

test('image proxy URL parsing accepts retailer srcset and rejects local URLs', () => {
  assert.equal(
    offerRouter.__private.parseSafeImageUrl('https://www.bipa.at/image.png?sw=140 1x, https://www.bipa.at/image.png?sw=280 2x'),
    'https://www.bipa.at/image.png?sw=140'
  );
  assert.equal(offerRouter.__private.parseSafeImageUrl('http://127.0.0.1/image.png'), null);
});

test('image proxy headers include image accept and optional referer for retailer CDNs', () => {
  const headers = buildImageRequestHeaders({ referer: 'https://www.bipa.at/p/test' });

  assert.match(headers.Accept, /image\/webp/);
  assert.match(headers['User-Agent'], /Mozilla/);
  assert.equal(headers.Referer, 'https://www.bipa.at/p/test');
});

test('image proxy projection preserves official snapshot freshness evidence', () => {
  const now = new Date('2026-08-27T08:00:00+02:00');
  const offer = {
    imageUrl: 'https://images.example.test/coffee.jpg',
    sourceId: 'source-billa',
    title: 'Tchibo Kaffee Angebot',
    retailerKey: 'billa',
    retailerName: 'BILLA',
    sourceUrl: 'https://www.billa.at/produkte/tchibo-kaffee',
    sourceType: 'billa-official-algolia',
    status: 'active',
    isActiveNow: true,
    validFrom: new Date('2026-08-27T04:00:00Z'),
    validTo: null,
    lastSeenAt: new Date('2026-08-27T04:40:44Z'),
    crawlRunId: 'crawl-run-1',
    crawlJobId: 'crawl-job-1',
    publishStatus: 'crawl-run-success',
    sourceRunStatus: 'success',
    priceCurrent: { amount: 6.99, currency: 'EUR' },
    quantityText: '500 g',
    rawFacts: { snapshotCurrent: true },
  };
  const projection = offerRouter.__private.imageOfferProjection;
  const projectedOffer = Object.fromEntries(
    Object.entries(offer).filter(([field]) => projection[field])
  );

  assert.equal(projection.crawlRunId, 1);
  assert.equal(projection.retailerKey, 1);
  assert.equal(isOfferFreshForActiveUse(projectedOffer, now), true);
  assert.equal(isOfferFreshForActiveUse({ ...projectedOffer, crawlRunId: undefined }, now), false);
  assert.equal(isOfferFreshForActiveUse({ ...projectedOffer, retailerKey: undefined }, now), false);
});
