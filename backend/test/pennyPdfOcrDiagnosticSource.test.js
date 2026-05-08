const assert = require('node:assert/strict');
const test = require('node:test');
const {
  extractIssuuDocumentFromUrl,
  extractIssuuDocumentsFromHtml,
} = require('../src/services/crawl/issuuPdfResolver');
const {
  resolvePdfDownloadForDiagnostics,
} = require('../scripts/diagnosePennyPdfOcr');

function httpError(url, status, message = 'Request failed') {
  const error = new Error(message);
  error.config = { url };
  error.response = {
    status,
    statusText: status === 403 ? 'Forbidden' : 'Error',
    request: {
      res: {
        responseUrl: url,
      },
    },
  };
  return error;
}

test('parses Issuu document urls and embed html for PDF refresh', () => {
  const direct = extractIssuuDocumentFromUrl('https://issuu.com/pennyat/docs/digitales_flugblatt_kw19');
  assert.equal(direct.username, 'pennyat');
  assert.equal(direct.documentName, 'digitales_flugblatt_kw19');

  const documents = extractIssuuDocumentsFromHtml(`
    <iframe src="https://e.issuu.com/embed.html?u=pennyat&d=digitales_flugblatt_kw20"></iframe>
  `);

  assert.equal(documents.length, 1);
  assert.equal(documents[0].username, 'pennyat');
  assert.equal(documents[0].documentName, 'digitales_flugblatt_kw20');
});

test('manual PENNY_PDF_URL override is preferred and skips refresh', async () => {
  let refreshCalled = false;
  const result = await resolvePdfDownloadForDiagnostics({
    rawDocument: {
      finalUrl: 'https://expired.example.test/flyer.pdf',
    },
    env: {
      PENNY_PDF_URL: 'https://manual.example.test/flyer.pdf',
    },
    fetchPdfBufferFn: async (url) => ({
      buffer: Buffer.from('%PDF manual'),
      httpStatus: 200,
      contentType: 'application/pdf',
      finalUrl: url,
    }),
    refreshPdfUrlFn: async () => {
      refreshCalled = true;
      return { ok: false };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.selectedPdfUrl, 'https://manual.example.test/flyer.pdf');
  assert.equal(result.selectedPdfUrlSource, 'env:PENNY_PDF_URL');
  assert.deepEqual(result.attemptedDownloadUrls, ['https://manual.example.test/flyer.pdf']);
  assert.equal(refreshCalled, false);
});

test('403 on stored selectedPdfUrl attempts refreshed source URL', async () => {
  const attemptedFetches = [];
  const result = await resolvePdfDownloadForDiagnostics({
    rawDocument: {
      finalUrl: 'https://expired.example.test/flyer.pdf?token=old',
    },
    source: {
      sourceUrl: 'https://issuu.com/pennyat/docs/digitales_flugblatt_kw20',
    },
    env: {},
    fetchPdfBufferFn: async (url) => {
      attemptedFetches.push(url);

      if (url.includes('expired.example.test')) {
        throw httpError(url, 403);
      }

      return {
        buffer: Buffer.from('%PDF fresh'),
        httpStatus: 200,
        contentType: 'application/pdf',
        finalUrl: url,
      };
    },
    refreshPdfUrlFn: async () => ({
      ok: true,
      pdfUrl: 'https://fresh.example.test/flyer.pdf?token=new',
      sourceUrl: 'https://issuu.com/pennyat/docs/digitales_flugblatt_kw20',
      attemptedSourceUrls: ['https://issuu.com/pennyat/docs/digitales_flugblatt_kw20'],
      reason: '',
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.selectedPdfUrl, 'https://fresh.example.test/flyer.pdf?token=new');
  assert.equal(result.selectedPdfUrlSource, 'refreshed-from-source-url');
  assert.deepEqual(attemptedFetches, [
    'https://expired.example.test/flyer.pdf?token=old',
    'https://fresh.example.test/flyer.pdf?token=new',
  ]);
  assert.deepEqual(result.attemptedDownloadUrls, attemptedFetches);
  assert.equal(result.refresh.ok, true);
});

test('failed refresh determination does not crash and returns clear diagnostics', async () => {
  const result = await resolvePdfDownloadForDiagnostics({
    rawDocument: {
      finalUrl: 'https://expired.example.test/flyer.pdf',
    },
    env: {},
    fetchPdfBufferFn: async (url) => {
      throw httpError(url, 403);
    },
    refreshPdfUrlFn: async () => ({
      ok: false,
      pdfUrl: '',
      attemptedSourceUrls: ['https://www.penny.at/angebote'],
      reason: 'No Issuu document found.',
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.failure.statusCode, 403);
  assert.deepEqual(result.attemptedDownloadUrls, ['https://expired.example.test/flyer.pdf']);
  assert.equal(result.refresh.ok, false);
  assert.match(result.refresh.reason, /No Issuu document found/);
  assert.match(result.nextHint, /HTTP 403/);
});

test('diagnostic PDF source resolver has no database mutation contract', async () => {
  const result = await resolvePdfDownloadForDiagnostics({
    rawDocument: {
      finalUrl: 'https://example.test/flyer.pdf',
    },
    env: {},
    fetchPdfBufferFn: async (url) => ({
      buffer: Buffer.from('%PDF readonly'),
      httpStatus: 200,
      contentType: 'application/pdf',
      finalUrl: url,
    }),
    refreshPdfUrlFn: async () => {
      throw new Error('refresh should not run');
    },
  });

  assert.equal(result.ok, true);
  assert.equal(Object.hasOwn(result, 'mutatedCollections'), false);
});
