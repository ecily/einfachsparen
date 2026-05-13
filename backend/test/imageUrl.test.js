const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildImageRequestHeaders,
  isUsableImageUrl,
  normalizeImageUrl,
  parseSrcsetCandidates,
} = require('../src/services/images/imageUrl');
const offerRouter = require('../src/routes/offer.routes');

test('normalizes absolute, relative and srcset image URLs', () => {
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
