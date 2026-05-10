const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildEvidenceSnippetsFromPages,
  buildSeedMetadata,
  buildNextParserFixPlan,
  classifyEvidenceResult,
  classifySparFlyerPdfUrl,
  hasCoffeeTerm,
} = require('../src/services/diagnostics/sparFlyerPdfEvidenceDiagnostic');

test('classifies allowed SPAR and INTERSPAR flyer PDF endpoints', () => {
  assert.deepEqual(
    classifySparFlyerPdfUrl('https://flugblatt.spar.at/steiermark/spar/260507-1-flugblatt-kw-19/getPdf.ashx'),
    {
      allowed: true,
      reason: '',
      host: 'flugblatt.spar.at',
      regionKey: 'steiermark',
      retailerScope: 'spar',
      pdfEndpointType: 'getpdf',
    }
  );

  const interspar = classifySparFlyerPdfUrl('https://flugblatt.interspar.at/steiermark/steiermark_kw19/ViewPdf.ashx');
  assert.equal(interspar.allowed, true);
  assert.equal(interspar.regionKey, 'steiermark');
  assert.equal(interspar.retailerScope, 'interspar');
  assert.equal(interspar.pdfEndpointType, 'viewpdf');
});

test('rejects non-public or non-flyer hosts for production evidence', () => {
  assert.equal(classifySparFlyerPdfUrl('http://flugblatt.spar.at/steiermark/spar/x/getPdf.ashx').allowed, false);
  assert.equal(classifySparFlyerPdfUrl('https://www.spar.at/aktionen/steiermark').allowed, false);
  assert.equal(classifySparFlyerPdfUrl('https://example.test/flyer.pdf').allowed, false);
});

test('detects coffee terms with accents and brand variants', () => {
  assert.equal(hasCoffeeTerm('Lavazza Espresso ganze Bohne 1 kg'), true);
  assert.equal(hasCoffeeTerm('Nescafé Gold löskaffee'), true);
  assert.equal(hasCoffeeTerm('Cafe Royal Kapseln'), true);
  assert.equal(hasCoffeeTerm('Frische Erdbeeren 500 g'), false);
});

test('builds PDF evidence snippets with page, price and quantity hints', () => {
  const snippets = buildEvidenceSnippetsFromPages([
    {
      pageNumber: 4,
      text: [
        'JACOBS Caffe Crema',
        'ganze Bohne 1 kg',
        'statt 24.99',
        '17.49',
      ].join('\n'),
    },
  ]);

  assert.equal(snippets.length, 1);
  assert.equal(snippets[0].page, 4);
  assert.deepEqual(snippets[0].matchedTerms, ['caffe', 'jacobs']);
  assert.equal(snippets[0].priceHint, 24.99);
  assert.equal(snippets[0].quantityHint, '1 kg');
});

test('seed metadata parses validity from source-side label text', () => {
  const metadata = buildSeedMetadata({
    url: 'https://flugblatt.spar.at/steiermark/eurospar/260507-1-flugblatt-kw-19/getPdf.ashx',
    label: 'EUROSPAR Steiermark Flugblatt KW 19',
    validityText: 'Do., 07.05.26 - Mi., 20.05.26',
  });

  assert.equal(metadata.regionKey, 'steiermark');
  assert.equal(metadata.retailerScope, 'eurospar');
  assert.equal(metadata.validFrom, '2026-05-07');
  assert.equal(metadata.validTo, '2026-05-20');
});

test('safe production classification requires reachable PDF and scoped validity', () => {
  assert.equal(classifyEvidenceResult({
    urlInfo: { allowed: false },
  }), 'unsafe-for-production');

  assert.equal(classifyEvidenceResult({
    urlInfo: { allowed: true },
    reachable: false,
  }), 'pdf-not-reachable');

  assert.equal(classifyEvidenceResult({
    urlInfo: { allowed: true },
    reachable: true,
    plausiblePdf: true,
    error: 'maxContentLength size of 12582912 exceeded',
    pdf: null,
    coffeeEvidence: [],
  }), 'needs-manual-snapshot');

  assert.equal(classifyEvidenceResult({
    urlInfo: { allowed: true },
    reachable: true,
    plausiblePdf: true,
    coffeeEvidence: [],
  }), 'pdf-reachable-no-coffee');

  assert.equal(classifyEvidenceResult({
    urlInfo: { allowed: true },
    reachable: true,
    plausiblePdf: true,
    coffeeEvidence: [{ snippet: 'Jacobs Kaffee 1 kg 17.49', priceHint: 17.49, quantityHint: '1 kg' }],
    regionKey: 'steiermark',
    retailerScope: 'spar',
    validFrom: '2026-05-07',
    validTo: '2026-05-20',
  }), 'parser-ready');
});

test('next parser fix plan is emitted only for coffee evidence', () => {
  assert.equal(buildNextParserFixPlan([]), null);
  const plan = buildNextParserFixPlan([
    {
      classification: 'parser-ready',
      sourceUrl: 'https://flugblatt.spar.at/steiermark/spar/x/getPdf.ashx',
      retailerScope: 'spar',
    },
  ]);

  assert.equal(plan.sourceKey, 'spar-official-flyer-pdf');
  assert.ok(plan.beforeAfterApiChecks.some((item) => item.includes('retailers=spar')));
});
