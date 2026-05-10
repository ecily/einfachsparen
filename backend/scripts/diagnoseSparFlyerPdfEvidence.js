const {
  buildSparFlyerPdfEvidenceDiagnostic,
} = require('../src/services/diagnostics/sparFlyerPdfEvidenceDiagnostic');

function parseArgs(argv = []) {
  return {
    json: argv.includes('--json'),
  };
}

function parsePositiveInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function printTextReport(report) {
  console.log(`SPAR Flyer PDF Evidence Diagnostic (${report.generatedAt})`);
  console.log(`readOnly=${report.readOnly} mutatedCollections=${report.mutatedCollections.length}`);
  console.log(`checkedUrlCount=${report.checkedUrlCount} reachablePdfCount=${report.summary.reachablePdfCount} coffeeEvidenceCount=${report.summary.coffeeEvidenceCount}`);

  for (const result of report.results) {
    console.log(`- ${result.label || result.sourceUrl}`);
    console.log(`  classification=${result.classification} status=${result.httpStatus || 'n/a'} contentType=${result.contentType || 'n/a'} bytes=${result.downloadedBytes || 0}`);
    console.log(`  scope=${result.regionKey || '?'}:${result.retailerScope || '?'} valid=${result.validFrom || '?'}..${result.validTo || '?'}`);
    for (const evidence of result.coffeeEvidence.slice(0, 3)) {
      console.log(`  coffee page=${evidence.page} terms=${evidence.matchedTerms.join(',')} price=${evidence.priceHint || '?'} qty=${evidence.quantityHint || '?'} ${evidence.snippet}`);
    }
  }

  console.log(`recommendation=${report.summary.productionRecommendation}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await buildSparFlyerPdfEvidenceDiagnostic({
    maxUrls: parsePositiveInt(process.env.SPAR_FLYER_PDF_MAX_URLS),
    timeoutMs: parsePositiveInt(process.env.SPAR_FLYER_PDF_TIMEOUT_MS),
    maxPdfBytes: parsePositiveInt(process.env.SPAR_FLYER_PDF_MAX_BYTES),
    maxPdfPages: parsePositiveInt(process.env.SPAR_FLYER_PDF_MAX_PAGES),
    textExtractor: process.env.SPAR_FLYER_PDF_TEXT_EXTRACTOR || undefined,
    retailerScopes: parseCsv(process.env.SPAR_FLYER_PDF_RETAILER_SCOPES),
  });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printTextReport(report);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
