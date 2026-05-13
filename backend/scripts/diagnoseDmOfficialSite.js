const { Types } = require('mongoose');
const { __private } = require('../src/services/crawl/officialSourceCrawler');

async function main() {
  const report = await __private.diagnoseDmOfficialSaleSource({
    source: {
      _id: new Types.ObjectId(),
      retailerKey: 'dm',
      retailerName: 'dm',
      channel: 'official-site',
      sourceType: 'offers-page',
      sourceUrl: 'https://www.dm.at/ausverkauf',
      label: 'dm Ausverkauf',
    },
    region: 'AT',
    crawlJobId: new Types.ObjectId(),
  });

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    message: error.message,
    stack: error.stack,
  }, null, 2));
  process.exitCode = 1;
});
