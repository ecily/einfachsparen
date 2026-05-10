const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE_URL = 'https://www.spar.at/aktionen/steiermark';
const SNAPSHOT_PATH = path.resolve(__dirname, '..', 'test', 'fixtures', 'spar-official-steiermark-real-snapshot.html');
const META_PATH = path.resolve(__dirname, '..', 'test', 'fixtures', 'spar-official-steiermark-real-snapshot.meta.json');
const DEFAULT_TIMEOUT_MS = 20000;

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function buildMarkerChecks(html) {
  const text = normalizeText(html);

  return {
    hasActionsAndFlyers: /Aktionen\s*(?:&|und)?\s*Flugblätter|Aktionen\s*(?:&|und)?\s*Flugblaetter|Flugblatt|Flugblätter|Flugblaetter/i.test(text),
    hasSteiermark: /Steiermark/i.test(text),
    hasSpar: /\bSPAR\b/i.test(text),
    hasEurosparOrInterspar: /\b(?:EUROSPAR|INTERSPAR)\b/i.test(text),
    hasFlyerLink: /flugblatt\.spar\.at|Zum Flugblatt|PDF\s*(?:anzeigen|herunterladen|download)/i.test(text),
  };
}

function isPlausibleHtmlContentType(contentType) {
  return /text\/html|application\/xhtml\+xml/i.test(String(contentType || ''));
}

function validateSnapshotPayload({ status, contentType, html }) {
  const markerChecks = buildMarkerChecks(html);
  const failedMarkers = Object.entries(markerChecks)
    .filter(([, passed]) => !passed)
    .map(([key]) => key);
  const errors = [];

  if (Number(status) !== 200) {
    errors.push(`unexpected-http-status:${status}`);
  }

  if (!isPlausibleHtmlContentType(contentType)) {
    errors.push(`unexpected-content-type:${contentType || 'missing'}`);
  }

  if (failedMarkers.length > 0) {
    errors.push(`missing-markers:${failedMarkers.join(',')}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    markerChecks,
  };
}

function buildSnapshotMetadata({
  fetchedAt = new Date().toISOString(),
  sourceUrl = SOURCE_URL,
  status,
  contentType,
  html,
} = {}) {
  return {
    fetchedAt,
    sourceUrl,
    status: Number(status || 0),
    contentType: String(contentType || ''),
    bytes: Buffer.byteLength(String(html || ''), 'utf8'),
    sha256: sha256(html),
    markerChecks: buildMarkerChecks(html),
  };
}

function assertCanWriteSnapshot(filePath, { overwrite = false } = {}) {
  if (fs.existsSync(filePath) && !overwrite) {
    const error = new Error(`Snapshot already exists: ${filePath}. Re-run with --overwrite to replace it.`);
    error.code = 'SNAPSHOT_EXISTS';
    throw error;
  }
}

function parseArgs(argv = process.argv.slice(2)) {
  return {
    overwrite: argv.includes('--overwrite'),
  };
}

async function fetchSparOfficialSnapshot({
  fetchImpl = globalThis.fetch,
  sourceUrl = SOURCE_URL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('No fetch implementation available in this Node runtime.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(sourceUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de-AT,de;q=0.9,en;q=0.6',
        'Cache-Control': 'no-cache',
        'User-Agent': 'kaufklug-local-parser-diagnostic/1.0 (+https://kaufklug.at; manual snapshot fetch)',
      },
    });
    const html = await response.text();
    const contentType = response.headers?.get ? response.headers.get('content-type') : '';

    return {
      status: response.status,
      contentType,
      html,
      finalUrl: response.url || sourceUrl,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function writeSnapshotFiles({
  html,
  status,
  contentType,
  sourceUrl = SOURCE_URL,
  snapshotPath = SNAPSHOT_PATH,
  metaPath = META_PATH,
  overwrite = false,
  fetchedAt = new Date().toISOString(),
} = {}) {
  assertCanWriteSnapshot(snapshotPath, { overwrite });

  const metadata = buildSnapshotMetadata({
    fetchedAt,
    sourceUrl,
    status,
    contentType,
    html,
  });
  const validation = validateSnapshotPayload({ status, contentType, html });
  if (!validation.ok) {
    const error = new Error(`Refusing to write implausible SPAR snapshot: ${validation.errors.join('; ')}`);
    error.code = 'SNAPSHOT_VALIDATION_FAILED';
    error.validation = validation;
    error.metadata = metadata;
    throw error;
  }

  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.writeFileSync(snapshotPath, String(html || ''), 'utf8');
  fs.writeFileSync(metaPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');

  return {
    snapshotPath,
    metaPath,
    metadata,
  };
}

async function main() {
  const options = parseArgs();

  try {
    const fetched = await fetchSparOfficialSnapshot();
    const result = await writeSnapshotFiles({
      html: fetched.html,
      status: fetched.status,
      contentType: fetched.contentType,
      sourceUrl: SOURCE_URL,
      overwrite: options.overwrite,
    });

    console.log(JSON.stringify({
      ok: true,
      snapshotPath: result.snapshotPath,
      metaPath: result.metaPath,
      finalUrl: fetched.finalUrl,
      ...result.metadata,
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      error: error.message,
      code: error.code || '',
      hint: error.code === 'SNAPSHOT_EXISTS'
        ? 'Use npm run fetch:spar-official-snapshot -- --overwrite to replace the local snapshot.'
        : 'No tests depend on this fetch. If SPAR blocks or changes the response, save the HTML manually under test/fixtures/spar-official-steiermark-real-snapshot.html.',
      validation: error.validation || undefined,
      metadata: error.metadata || undefined,
    }, null, 2));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  META_PATH,
  SNAPSHOT_PATH,
  SOURCE_URL,
  assertCanWriteSnapshot,
  buildMarkerChecks,
  buildSnapshotMetadata,
  fetchSparOfficialSnapshot,
  isPlausibleHtmlContentType,
  parseArgs,
  sha256,
  validateSnapshotPayload,
  writeSnapshotFiles,
};
