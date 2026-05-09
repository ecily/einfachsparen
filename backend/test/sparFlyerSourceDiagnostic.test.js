const assert = require('node:assert/strict');
const test = require('node:test');
const {
  findEvidenceHits,
  evaluateCandidateSource,
  buildSparFlyerSourceDiagnostic,
} = require('../src/services/diagnostics/sparFlyerSourceDiagnostic');

test('matches SPAR coffee evidence accent-insensitively and with compact quantities', () => {
  const hits = findEvidenceHits([
    'REGIO Gold Kaffee 500g',
    'Nescafé Löskaffee 200 g',
    'Café Royal Kapseln',
    'Bis zu -25% auf alle Kaffees',
    'Julius Meinl Präsident',
    'Dallmayr Prodomo',
  ].join(' '));
  const terms = hits.map((hit) => hit.normalized);

  assert.ok(terms.includes('regio'));
  assert.ok(terms.includes('regio gold'));
  assert.ok(terms.includes('nescafe'));
  assert.ok(terms.includes('loskaffee'));
  assert.ok(terms.includes('cafe royal'));
  assert.ok(terms.includes('500 g'));
  assert.ok(terms.includes('200 g'));
  assert.ok(terms.includes('25'));
  assert.ok(terms.includes('prasident'));
  assert.ok(terms.includes('dallmayr'));
  assert.ok(terms.includes('prodomo'));
});

test('evaluates simulated HTML source without network access', async () => {
  const result = await evaluateCandidateSource({
    candidate: {
      key: 'html-candidate',
      url: 'https://example.test/spar',
      expectedMode: 'html',
    },
    fetched: {
      status: 200,
      contentType: 'text/html; charset=utf-8',
      finalUrl: 'https://example.test/spar',
      size: 500,
      buffer: Buffer.from('<html><body><h1>SPAR Flugblatt</h1><p>Tassimo Kapseln 25%</p></body></html>'),
    },
  });

  assert.equal(result.accessible, true);
  assert.equal(result.extractionMode, 'html-text');
  assert.ok(result.evidenceHits.some((hit) => hit.normalized === 'tassimo'));
  assert.ok(result.evidenceHits.some((hit) => hit.normalized === 'kapseln'));
  assert.ok(result.evidenceHits.some((hit) => hit.normalized === '25'));
});

test('evaluates simulated PDF text using injectable extraction only', async () => {
  const result = await evaluateCandidateSource({
    candidate: {
      key: 'pdf-candidate',
      url: 'https://example.test/spar.pdf',
      expectedMode: 'pdf',
    },
    fetched: {
      status: 200,
      contentType: 'application/pdf',
      finalUrl: 'https://cdn.example.test/spar.pdf',
      size: 1234,
      buffer: Buffer.from('%PDF-simulated'),
    },
    extractPdfText: async () => 'Dallmayr Prodomo Kaffee 500 g und Cafe Royal Kapseln',
  });

  assert.equal(result.accessible, true);
  assert.equal(result.extractionMode, 'pdf-text');
  assert.equal(result.finalUrl, 'https://cdn.example.test/spar.pdf');
  assert.ok(result.evidenceHits.some((hit) => hit.normalized === 'dallmayr'));
  assert.ok(result.evidenceHits.some((hit) => hit.normalized === 'prodomo'));
  assert.ok(result.evidenceHits.some((hit) => hit.normalized === '500 g'));
});

test('marks blocked candidates without attempting extraction', async () => {
  let extracted = false;
  const result = await evaluateCandidateSource({
    candidate: {
      key: 'blocked-candidate',
      url: 'https://example.test/blocked',
      expectedMode: 'html',
    },
    fetched: {
      status: 403,
      contentType: 'text/html',
      size: 100,
      buffer: Buffer.from('forbidden'),
    },
    extractPdfText: async () => {
      extracted = true;
      return '';
    },
  });

  assert.equal(result.accessible, false);
  assert.equal(result.extractionMode, 'blocked');
  assert.equal(result.reasonIfRejected, 'HTTP 403');
  assert.equal(extracted, false);
});

test('builds full SPAR flyer diagnostic from simulated fetches only', async () => {
  const report = await buildSparFlyerSourceDiagnostic({
    now: '2026-05-09T10:00:00.000Z',
    candidates: [
      { key: 'blocked-html', url: 'https://example.test/blocked', expectedMode: 'html' },
      { key: 'usable-pdf', url: 'https://example.test/flyer.pdf', expectedMode: 'pdf' },
    ],
    fetchSource: async (candidate) => {
      if (candidate.key === 'blocked-html') {
        return {
          status: 403,
          contentType: 'text/html',
          finalUrl: candidate.url,
          size: 42,
          buffer: Buffer.from('Forbidden'),
        };
      }

      return {
        status: 200,
        contentType: 'application/pdf',
        finalUrl: 'https://cdn.example.test/flyer.pdf',
        size: 2048,
        buffer: Buffer.from('%PDF-simulated'),
      };
    },
    extractPdfText: async () => 'REGIO Gold Kaffee 500 g -25 %',
  });

  assert.equal(report.ok, true);
  assert.equal(report.readOnly, true);
  assert.deepEqual(report.mutatedCollections, []);
  assert.equal(report.checkedAt, '2026-05-09T10:00:00.000Z');
  assert.equal(report.candidateSources.length, 2);
  assert.equal(report.summary.usableCandidatesCount, 1);
  assert.deepEqual(report.summary.candidatesWithCoffeeEvidence, ['usable-pdf']);
  assert.match(report.summary.likelyNextStep, /read-only PDF text-layer parser/);
});
