const fs = require('node:fs');
const path = require('node:path');
const {
  PARSER_VERSION,
  extractSparPdfCandidates,
  sourceKeyForFormat,
  summarizeRejections,
} = require('../src/services/crawl/sparOfficialFlyerPdfParser');

function loadFixture() {
  return JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'test', 'fixtures', 'spar-official-flyer-pdf-textlayers.json'),
    'utf8'
  ));
}

function buildReport() {
  const fixture = loadFixture();
  const groups = new Map();

  for (const page of fixture.pages) {
    const format = page.sourceRetailerFormat || 'spar';
    if (!groups.has(format)) groups.set(format, []);
    groups.get(format).push(page);
  }

  const formats = [...groups.entries()].map(([format, pages]) => {
    const candidates = extractSparPdfCandidates({
      pages,
      sourceRetailerFormat: format,
      validity: fixture.validity,
    });
    const accepted = candidates.filter((candidate) => !candidate.exclusionReason);

    return {
      sourceRetailerFormat: format,
      sourceKey: sourceKeyForFormat(format),
      candidateCount: candidates.length,
      acceptedCount: accepted.length,
      rejectedCount: candidates.length - accepted.length,
      rejectionReasons: summarizeRejections(candidates),
      acceptedOffers: accepted.map((candidate) => ({
        title: candidate.title,
        brand: candidate.brand,
        price: candidate.price,
        quantityText: candidate.quantityText,
        page: candidate.page,
      })),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    mutatedCollections: [],
    parserVersion: PARSER_VERSION,
    fixture: 'test/fixtures/spar-official-flyer-pdf-textlayers.json',
    formats,
    summary: {
      acceptedCount: formats.reduce((sum, item) => sum + item.acceptedCount, 0),
      rejectedCount: formats.reduce((sum, item) => sum + item.rejectedCount, 0),
      sourceKeys: formats.map((item) => item.sourceKey),
    },
  };
}

function printText(report) {
  console.log(`SPAR PDF ingestion diagnostic (${report.generatedAt})`);
  console.log(`readOnly=${report.readOnly} parserVersion=${report.parserVersion}`);
  for (const format of report.formats) {
    console.log(`- ${format.sourceKey}: accepted=${format.acceptedCount} rejected=${format.rejectedCount}`);
    for (const offer of format.acceptedOffers) {
      console.log(`  ${offer.brand} ${offer.title} ${offer.quantityText} ${offer.price}`);
    }
  }
}

const report = buildReport();

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printText(report);
}

module.exports = {
  buildReport,
};
