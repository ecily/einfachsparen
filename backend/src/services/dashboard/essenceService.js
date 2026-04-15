const CrawlJob = require('../../models/CrawlJob');

async function buildLatestEssenceDigest() {
  const jobs = await CrawlJob.find({ status: { $in: ['success', 'partial'] } })
    .sort({ startedAt: -1 })
    .limit(24)
    .lean();

  if (jobs.length === 0) {
    return 'Noch kein Crawl gelaufen.';
  }

  const latestByRetailer = new Map();

  for (const job of jobs) {
    const essence = job.metadata?.essence;

    if (!essence || latestByRetailer.has(job.retailerKey)) {
      continue;
    }

    latestByRetailer.set(job.retailerKey, `${job.retailerKey}: ${essence}`);
  }

  const lines = [...latestByRetailer.values()];

  return lines.join('\n');
}

module.exports = {
  buildLatestEssenceDigest,
};
