const fs = require('node:fs');
const path = require('node:path');
const {
  extractSparOfficialFlyerPage,
} = require('../src/services/crawl/sparOfficialFlyerParser');

function summarize(result) {
  const dateParseWarnings = [
    ...result.flyers.flatMap((flyer) => flyer.quality?.parseWarnings || []),
    ...result.actionCandidates.flatMap((action) => action.quality?.parseWarnings || []),
  ];

  return {
    sourceKey: result.sourceKey,
    sourceUrl: result.sourceUrl,
    region: result.region,
    extractedFlyersCount: result.flyers.length,
    extractedActionsCount: result.actionCandidates.length,
    retailerScopes: [...new Set(result.flyers.map((flyer) => flyer.retailerScope).filter(Boolean))],
    dateParseWarnings: [...new Set(dateParseWarnings.filter((warning) => /validity|date|year/i.test(warning)))],
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

function main() {
  const fixturePath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(__dirname, '..', 'test', 'fixtures', 'spar-official-steiermark-actions.html');
  const html = fs.readFileSync(fixturePath, 'utf8');
  const result = extractSparOfficialFlyerPage(html, {
    sourceUrl: 'https://www.spar.at/aktionen/steiermark',
  });

  console.log(JSON.stringify(summarize(result), null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  summarize,
};
