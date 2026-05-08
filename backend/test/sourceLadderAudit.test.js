const assert = require('node:assert/strict');
const test = require('node:test');
const {
  inferExtractionMethod,
  buildRetailerAudit,
  buildSourcesLadderAudit,
} = require('../src/services/diagnostics/sourceLadderAudit');

test('maps source types to the source quality ladder', () => {
  assert.equal(inferExtractionMethod({ sourceType: 'billa-official-algolia' }), 'structured-json');
  assert.equal(inferExtractionMethod({ sourceType: 'lidl-official-flyer-api' }), 'structured-json');
  assert.equal(inferExtractionMethod({ sourceType: 'penny-official-html' }), 'official-html');
  assert.equal(inferExtractionMethod({ sourceType: 'aktionsfinder-json' }), 'aggregator-json');
  assert.equal(inferExtractionMethod({ sourceType: 'issuu-viewer', url: 'https://issuu.com/pennyat/docs/flyer' }), 'viewer-metadata');
  assert.equal(inferExtractionMethod({ sourceType: 'penny-official-pdf', documentType: 'pdf' }), 'pdf-textlayer');
  assert.equal(inferExtractionMethod({ sourceType: 'penny-pdf-ocr-bbox' }), 'ocr-bbox');
});

test('recommends official structured data over aggregator and PDF/OCR evidence', () => {
  const audit = buildRetailerAudit({
    retailer: { retailerKey: 'billa', retailerName: 'BILLA' },
    definitions: [
      {
        retailerKey: 'billa',
        retailerName: 'BILLA',
        channel: 'aggregator',
        label: 'Aktionsfinder BILLA Aktionen',
        sourceUrl: 'https://www.aktionsfinder.at/pv/billa/',
      },
      {
        retailerKey: 'billa',
        retailerName: 'BILLA',
        channel: 'official-site',
        label: 'BILLA Aktionen',
        sourceUrl: 'https://www.billa.at/unsere-aktionen/aktionen',
      },
    ],
    offerRows: [
      {
        retailerKey: 'billa',
        sourceType: 'aktionsfinder-json',
        offers: 100,
        activeNow: 100,
      },
      {
        retailerKey: 'billa',
        sourceType: 'billa-official-algolia',
        offers: 40,
        activeNow: 40,
        avgSourceConfidence: 0.95,
      },
      {
        retailerKey: 'billa',
        sourceType: 'billa-pdf-ocr-bbox',
        offers: 5,
        activeNow: 5,
      },
    ],
  });

  assert.equal(audit.recommendedPrimarySource.sourceType, 'billa-official-algolia');
  assert.equal(audit.recommendedPrimarySource.extractionMethod, 'structured-json');
  assert.equal(audit.hasOfficialStructuredJson, true);
  assert.equal(audit.hasAggregatorJson, true);
  assert.equal(audit.hasOcrDiagnostics, true);
  assert.equal(audit.ocrRole, 'diagnostic-only');
  assert.ok(audit.risks.some((risk) => /Dubletten/.test(risk)));
});

test('keeps OCR fallback-only when only PDF evidence exists', () => {
  const audit = buildRetailerAudit({
    retailer: { retailerKey: 'penny', retailerName: 'PENNY' },
    definitions: [
      {
        retailerKey: 'penny',
        retailerName: 'PENNY',
        channel: 'official-flyer',
        label: 'PENNY Flugblatt',
        sourceUrl: 'https://www.penny.at/angebote/flugblaetter',
      },
    ],
    rawRows: [
      {
        retailerKey: 'penny',
        sourceType: 'penny-official-pdf',
        documentType: 'pdf',
        documents: 1,
        parsedOffers: 120,
      },
    ],
    offerRows: [
      {
        retailerKey: 'penny',
        sourceType: 'penny-official-pdf',
        offers: 120,
        activeNow: 120,
      },
    ],
  });

  assert.equal(audit.recommendedPrimarySource.extractionMethod, 'pdf-textlayer');
  assert.equal(audit.hasOfficialPdf, true);
  assert.equal(audit.hasPdfTextLayerCheck, true);
  assert.equal(audit.ocrRole, 'fallback-only');
  assert.ok(audit.nextActions.some((action) => /PDF/.test(action)));
});

test('builds a read-only global sources ladder report without database access', () => {
  const report = buildSourcesLadderAudit({
    generatedAt: '2026-05-08T10:00:00.000Z',
    definitions: [
      {
        retailerKey: 'lidl',
        retailerName: 'LIDL',
        channel: 'official-flyer',
        label: 'Lidl Flugblatt',
        sourceUrl: 'https://www.lidl.at/c/flugblatt/s10012330',
      },
      {
        retailerKey: 'dm',
        retailerName: 'dm',
        channel: 'aggregator',
        label: 'Aktionsfinder dm',
        sourceUrl: 'https://www.aktionsfinder.at/pv/dm-drogerie-markt/',
      },
    ],
    offerDistribution: [
      {
        retailerKey: 'lidl',
        sourceType: 'lidl-official-flyer-api',
        offers: 88,
        activeNow: 88,
      },
      {
        retailerKey: 'dm',
        sourceType: 'aktionsfinder-json',
        offers: 42,
        activeNow: 42,
      },
    ],
    duplicateSignals: [
      {
        retailerKey: 'dm',
        duplicateGroups: 3,
      },
    ],
    codeHints: {
      ocrDiagnosticFiles: ['scripts/diagnosePennyPdfOcr.js'],
    },
  });

  assert.equal(report.ok, true);
  assert.equal(report.readOnly, true);
  assert.deepEqual(report.mutatedCollections, []);
  assert.equal(report.retailers.find((item) => item.retailerKey === 'lidl').recommendedPrimarySource.extractionMethod, 'structured-json');
  assert.equal(report.retailers.find((item) => item.retailerKey === 'penny').hasOcrDiagnostics, true);
  assert.ok(report.global.retailersWithGoodStructuredSource.includes('lidl'));
  assert.ok(report.global.retailersWhereSourcePrioritizationShouldImproveFirst.includes('dm'));
  assert.equal(report.global.topThreeNextDataQualityBlocks.length, 3);
});
