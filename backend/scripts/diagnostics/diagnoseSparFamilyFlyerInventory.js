const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const { RETAILER_DEFINITIONS } = require('../../src/services/sources/sourceDefinitions');
const {
  DEFAULT_ENTRY_POINTS,
  buildSparFamilyFlyerInventoryReport,
  discoverSparFamilyFlyers,
  getBackendSparFamilyPdfSources,
} = require('../../src/services/crawl/sparFamilyFlyerDiscovery');

const execFileAsync = promisify(execFile);
const OUT_DIR = path.resolve(__dirname, '../../tmp/diagnostics/spar-family-flyer-inventory');
const REPORT_JSON = path.join(OUT_DIR, 'spar-family-flyer-inventory-report.json');
const REPORT_MD = path.join(OUT_DIR, 'spar-family-flyer-inventory-report.md');

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    entryPoints: DEFAULT_ENTRY_POINTS,
    limits: {},
    windowsNoRevokeFallback: false,
  };

  for (const arg of argv) {
    if (arg.startsWith('--entry=')) {
      options.entryPoints = arg.slice('--entry='.length).split(',').map((item) => item.trim()).filter(Boolean);
    } else if (arg.startsWith('--max-entry-points=')) {
      options.limits.maxEntryPoints = Number(arg.slice('--max-entry-points='.length));
    } else if (arg.startsWith('--max-links=')) {
      options.limits.maxLinks = Number(arg.slice('--max-links='.length));
    } else if (arg.startsWith('--max-pdf-metadata=')) {
      options.limits.maxPdfMetadataLookups = Number(arg.slice('--max-pdf-metadata='.length));
    } else if (arg.startsWith('--timeout-ms=')) {
      options.limits.timeoutMs = Number(arg.slice('--timeout-ms='.length));
    } else if (arg === '--no-pdf-metadata') {
      options.limits.maxPdfMetadataLookups = 0;
    } else if (arg === '--windows-no-revoke-fallback') {
      options.windowsNoRevokeFallback = true;
    }
  }

  options.limits = Object.fromEntries(
    Object.entries(options.limits).filter(([, value]) => Number.isFinite(value) && value >= 0)
  );

  return options;
}

function createCurlNoRevokeHttpClient() {
  return {
    async get(url, config = {}) {
      const timeoutSeconds = Math.max(1, Math.ceil(Number(config.timeout || 15000) / 1000));
      const accept = config.headers?.Accept || 'text/html,application/xhtml+xml,application/pdf,*/*;q=0.8';
      const userAgent = config.headers?.['User-Agent'] || 'kaufklug-readonly-source-discovery/1.0';

      if (config.responseType !== 'arraybuffer') {
        const marker = '__KAUFKLUG_CURL_META__';
        const { stdout } = await execFileAsync('curl.exe', [
          '--ssl-no-revoke',
          '--silent',
          '--show-error',
          '-L',
          '--max-time',
          String(timeoutSeconds),
          '-A',
          userAgent,
          '-H',
          `Accept: ${accept}`,
          '-w',
          `${marker}%{http_code}\\t%{content_type}\\t%{url_effective}`,
          url,
        ], {
          timeout: (timeoutSeconds + 5) * 1000,
          windowsHide: true,
          encoding: 'utf8',
          maxBuffer: 20 * 1024 * 1024,
        });
        const markerIndex = stdout.lastIndexOf(marker);
        const body = markerIndex >= 0 ? stdout.slice(0, markerIndex) : stdout;
        const meta = markerIndex >= 0 ? stdout.slice(markerIndex + marker.length).split('\t') : [];
        const status = Number(meta[0] || 0) || null;
        const contentType = meta[1] || '';
        const finalUrl = meta[2] || url;

        return {
          status,
          headers: {
            'content-type': contentType,
            'content-length': String(Buffer.byteLength(body, 'utf8')),
          },
          data: body,
          request: {
            res: { responseUrl: finalUrl },
          },
        };
      }

      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'spar-family-discovery-'));
      const bodyPath = path.join(tempDir, 'body.bin');

      try {
        const { stdout } = await execFileAsync('curl.exe', [
          '--ssl-no-revoke',
          '--silent',
          '--show-error',
          '-L',
          '--max-time',
          String(timeoutSeconds),
          '-A',
          userAgent,
          '-H',
          `Accept: ${accept}`,
          '-o',
          bodyPath,
          '-w',
          '\\n%{http_code}\\n%{content_type}\\n%{url_effective}\\n',
          url,
        ], {
          timeout: (timeoutSeconds + 5) * 1000,
          windowsHide: true,
          encoding: 'utf8',
          maxBuffer: 1024 * 1024,
        });
        const body = await fs.readFile(bodyPath);
        const meta = String(stdout || '').trim().split(/\r?\n/);
        const finalUrl = meta.pop() || url;
        const contentType = meta.pop() || '';
        const status = Number(meta.pop() || 0) || null;

        return {
          status,
          headers: {
            'content-type': contentType,
            'content-length': String(body.length),
          },
          data: body,
          request: {
            res: { responseUrl: finalUrl },
          },
        };
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    },
  };
}

function markdownCell(value) {
  return String(value ?? '').replace(/\|/g, '/').replace(/\r?\n/g, ' ').trim();
}

function buildMarkdown(report) {
  const lines = [];
  lines.push('# SPAR-family Flyer Inventory');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Read-only: ${report.readOnly}`);
  lines.push(`Mutated collections: ${report.mutatedCollections.length}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Checked pages: ${report.summary.checkedPageCount}`);
  lines.push(`- Discovered PDFs: ${report.summary.discoveredPdfCount}`);
  lines.push(`- Missing in backend SourceDefinitions: ${report.summary.missingInBackendCount}`);
  lines.push(`- 24-page limit risks: ${report.summary.pageLimitRiskCount}`);
  lines.push(`- Non-food candidates: ${report.summary.nonFoodPdfCount}`);
  lines.push(`- Blocked entrypoints: ${report.summary.blockedEntryPointCount}`);
  lines.push('');
  lines.push('## Checked Pages');
  lines.push('');
  lines.push('| URL | Status | Fetch | Blocked | PDFs | Error |');
  lines.push('| --- | ---: | --- | --- | ---: | --- |');
  for (const page of report.checkedPages) {
    lines.push(`| ${markdownCell(page.url)} | ${markdownCell(page.httpStatus || 'n/a')} | ${markdownCell(page.fetchStatus)} | ${page.blockedLikely ? 'yes' : 'no'} | ${page.discoveredPdfCount} | ${markdownCell(page.error)} |`);
  }
  lines.push('');
  lines.push('## PDFs');
  lines.push('');
  lines.push('| URL | Source | Folder | Pages | >Default | >24 | Non-food | Validity | Backend | Fetch |');
  lines.push('| --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- |');
  for (const pdf of report.pdfs) {
    const inBackend = report.backendSources.some((source) => source.url === pdf.url);
    lines.push(`| ${markdownCell(pdf.url)} | ${markdownCell(pdf.sourceGuess)} | ${markdownCell(pdf.folderType)} | ${markdownCell(pdf.pageCount || 'n/a')} | ${pdf.wouldExceedDefaultMaxPages ? 'yes' : 'no'} | ${pdf.wouldExceedSparFamilyMaxPages24 ? 'yes' : 'no'} | ${markdownCell((pdf.matchedNonFoodTerms || []).join(', ') || 'no')} | ${pdf.containsValidityTerms ? 'yes' : 'no'} | ${inBackend ? 'yes' : 'no'} | ${markdownCell(pdf.fetchStatus)} |`);
  }
  lines.push('');
  lines.push('## Missing In Backend');
  lines.push('');
  for (const pdf of report.missingInBackend) {
    lines.push(`- ${pdf.url} (${pdf.sourceGuess}, ${pdf.folderType})`);
  }
  lines.push('');
  lines.push('## Backend Official PDFs Not Discovered');
  lines.push('');
  for (const source of report.backendNotDiscovered) {
    lines.push(`- ${source.url} (${source.sourceRetailerFormat || source.retailerKey})`);
  }
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const options = parseArgs();
  await fs.mkdir(OUT_DIR, { recursive: true });

  const discovery = await discoverSparFamilyFlyers({
    entryPoints: options.entryPoints,
    httpClient: options.windowsNoRevokeFallback ? createCurlNoRevokeHttpClient() : undefined,
    limits: options.limits,
  });
  const backendSources = getBackendSparFamilyPdfSources(RETAILER_DEFINITIONS);
  const report = buildSparFamilyFlyerInventoryReport({ discovery, backendSources });

  await fs.writeFile(REPORT_JSON, JSON.stringify(report, null, 2), 'utf8');
  await fs.writeFile(REPORT_MD, buildMarkdown(report), 'utf8');

  console.log(JSON.stringify({
    ok: true,
    readOnly: true,
    mutatedCollections: [],
    checkedPages: report.summary.checkedPageCount,
    discoveredPdfCount: report.summary.discoveredPdfCount,
    missingInBackendCount: report.summary.missingInBackendCount,
    pageLimitRiskCount: report.summary.pageLimitRiskCount,
    nonFoodPdfCount: report.summary.nonFoodPdfCount,
    reportJson: REPORT_JSON,
    reportMarkdown: REPORT_MD,
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      readOnly: true,
      mutatedCollections: [],
      error: error.message || String(error),
    }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = {
  OUT_DIR,
  REPORT_JSON,
  REPORT_MD,
  buildMarkdown,
  parseArgs,
};
