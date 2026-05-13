const axios = require('axios');
const https = require('node:https');
const { __private } = require('../src/services/crawl/officialSourceCrawler');

const SOURCE_URL = process.env.PENNY_OFFICIAL_SITE_URL || 'https://www.penny.at/angebote';

async function fetchPennyOfficialSite() {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml',
    'Accept-Language': 'de-AT,de;q=0.9,en;q=0.8',
  };

  try {
    const response = await axios.get(SOURCE_URL, {
      timeout: 30000,
      headers,
      validateStatus: () => true,
    });

    return { response, html: String(response.data || ''), tlsFallbackUsed: false, fetchError: '' };
  } catch (error) {
    const firstError = error.message;
    const response = await axios.get(SOURCE_URL, {
      timeout: 30000,
      headers,
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      validateStatus: () => true,
    });

    return {
      response,
      html: String(response.data || ''),
      tlsFallbackUsed: true,
      fetchError: firstError,
    };
  }
}

async function main() {
  const result = await fetchPennyOfficialSite();
  const report = __private.diagnosePennyOfficialSiteHtml({
    html: result.html,
    sourceUrl: SOURCE_URL,
    response: result.response,
    fetchError: result.fetchError,
  });

  console.log(JSON.stringify({
    ...report,
    finalUrl: result.response.request?.res?.responseUrl || SOURCE_URL,
    tlsFallbackUsed: result.tlsFallbackUsed,
    apiOrDetailsNeeded: report.detailPagesOrApiNeeded,
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({
      sourceUrl: SOURCE_URL,
      status: 'failed',
      error: error.message,
      httpStatus: error.response?.status ?? null,
      contentType: error.response?.headers?.['content-type'] || '',
    }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = {
  fetchPennyOfficialSite,
};
