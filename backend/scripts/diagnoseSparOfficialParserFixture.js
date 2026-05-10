const fs = require('node:fs');
const path = require('node:path');
const {
  extractSparOfficialFlyerPage,
} = require('../src/services/crawl/sparOfficialFlyerParser');

const SOURCE_URL = 'https://www.spar.at/aktionen/steiermark';
const SYNTHETIC_FIXTURE_PATH = path.resolve(__dirname, '..', 'test', 'fixtures', 'spar-official-steiermark-actions.html');
const REAL_SNAPSHOT_FIXTURE_PATH = path.resolve(__dirname, '..', 'test', 'fixtures', 'spar-official-steiermark-real-snapshot.html');
const REAL_SNAPSHOT_META_PATH = path.resolve(__dirname, '..', 'test', 'fixtures', 'spar-official-steiermark-real-snapshot.meta.json');
const REAL_SNAPSHOT_HINT = 'HTML von https://www.spar.at/aktionen/steiermark manuell speichern unter test/fixtures/spar-official-steiermark-real-snapshot.html';

function summarize(result) {
  const allWarnings = [
    ...result.flyers.flatMap((flyer) => flyer.quality?.parseWarnings || []),
    ...result.actionCandidates.flatMap((action) => action.quality?.parseWarnings || []),
  ];
  const uniqueWarnings = [...new Set(allWarnings.filter(Boolean))];

  return {
    available: true,
    sourceKey: result.sourceKey,
    sourceUrl: result.sourceUrl,
    region: result.region,
    extractedFlyersCount: result.flyers.length,
    extractedActionsCount: result.actionCandidates.length,
    scopes: [...new Set([
      ...result.flyers.map((flyer) => flyer.retailerScope),
      ...result.actionCandidates.map((action) => action.retailerScope),
    ].filter(Boolean))],
    pdfLinkCount: result.flyers.reduce((count, flyer) =>
      count + (flyer.pdfViewUrl ? 1 : 0) + (flyer.pdfDownloadUrl ? 1 : 0), 0),
    dateParseWarnings: uniqueWarnings.filter((warning) => /validity|date|year/i.test(warning)),
    parserWarnings: uniqueWarnings,
    sampleFlyers: result.flyers.slice(0, 3).map((flyer) => ({
      retailerScope: flyer.retailerScope,
      flyerTitle: flyer.flyerTitle,
      flyerType: flyer.flyerType,
      validFrom: flyer.validFrom,
      validTo: flyer.validTo,
      pdfViewUrl: flyer.pdfViewUrl,
      pdfDownloadUrl: flyer.pdfDownloadUrl,
      parseWarnings: flyer.quality?.parseWarnings || [],
    })),
    sampleActions: result.actionCandidates.slice(0, 3).map((action) => ({
      title: action.title,
      discountText: action.discountText,
      productScopeText: action.productScopeText,
      validFrom: action.validFrom,
      validTo: action.validTo,
      conditionsText: action.conditionsText,
      parseWarnings: action.quality?.parseWarnings || [],
    })),
  };
}

function summarizeFixture(fixturePath, options = {}) {
  if (!fs.existsSync(fixturePath)) {
    return {
      available: false,
      filePath: fixturePath,
      path: fixturePath,
      installHint: options.installHint || '',
      manualHint: options.manualHint || options.installHint || '',
    };
  }

  const html = fs.readFileSync(fixturePath, 'utf8');
  const stats = fs.statSync(fixturePath);
  const result = extractSparOfficialFlyerPage(html, {
    sourceUrl: SOURCE_URL,
  });
  const metaPath = options.metaPath || '';
  const metadata = metaPath && fs.existsSync(metaPath)
    ? JSON.parse(fs.readFileSync(metaPath, 'utf8'))
    : null;

  return {
    filePath: fixturePath,
    path: fixturePath,
    bytes: stats.size,
    metadata,
    ...summarize(result),
  };
}

function buildFixtureDiagnostics(options = {}) {
  const syntheticPath = options.syntheticPath || SYNTHETIC_FIXTURE_PATH;
  const realSnapshotPath = options.realSnapshotPath || REAL_SNAPSHOT_FIXTURE_PATH;

  return {
    syntheticFixture: summarizeFixture(syntheticPath),
    realSnapshotFixture: summarizeFixture(realSnapshotPath, {
      metaPath: options.realSnapshotMetaPath || REAL_SNAPSHOT_META_PATH,
      installHint: REAL_SNAPSHOT_HINT,
      manualHint: REAL_SNAPSHOT_HINT,
    }),
  };
}

function main() {
  const overridePath = process.argv[2] ? path.resolve(process.argv[2]) : '';
  const diagnostics = overridePath
    ? {
        syntheticFixture: summarizeFixture(overridePath),
        realSnapshotFixture: summarizeFixture(REAL_SNAPSHOT_FIXTURE_PATH, {
          metaPath: REAL_SNAPSHOT_META_PATH,
          installHint: REAL_SNAPSHOT_HINT,
          manualHint: REAL_SNAPSHOT_HINT,
        }),
      }
    : buildFixtureDiagnostics();

  console.log(JSON.stringify(diagnostics, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  REAL_SNAPSHOT_FIXTURE_PATH,
  REAL_SNAPSHOT_META_PATH,
  REAL_SNAPSHOT_HINT,
  SYNTHETIC_FIXTURE_PATH,
  buildFixtureDiagnostics,
  summarize,
  summarizeFixture,
};
