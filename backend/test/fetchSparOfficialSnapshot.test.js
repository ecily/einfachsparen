const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  assertCanWriteSnapshot,
  buildMarkerChecks,
  buildSnapshotMetadata,
  sha256,
  validateSnapshotPayload,
  writeSnapshotFiles,
} = require('../scripts/fetchSparOfficialSnapshot');

const plausibleSparHtml = `
  <!doctype html>
  <html>
    <head><title>Aktionen & Flugblätter | SPAR</title></head>
    <body>
      <h1>Aktionen & Flugblätter in Steiermark</h1>
      <section>
        <h2>SPAR und EUROSPAR Flugblatt KW 19</h2>
        <a href="https://flugblatt.spar.at/view/spar-kw19">Zum Flugblatt</a>
      </section>
    </body>
  </html>
`;

test('SPAR snapshot marker validation accepts plausible official HTML', () => {
  const markerChecks = buildMarkerChecks(plausibleSparHtml);
  const validation = validateSnapshotPayload({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    html: plausibleSparHtml,
  });

  assert.deepEqual(Object.values(markerChecks), [true, true, true, true, true]);
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.errors, []);
});

test('SPAR snapshot marker validation rejects unrelated HTML', () => {
  const validation = validateSnapshotPayload({
    status: 200,
    contentType: 'text/html',
    html: '<html><body><h1>Example Shop</h1></body></html>',
  });

  assert.equal(validation.ok, false);
  assert.match(validation.errors.join(';'), /missing-markers/);
});

test('existing snapshot is not overwritten without overwrite flag', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spar-snapshot-test-'));
  const snapshotPath = path.join(tempDir, 'snapshot.html');

  fs.writeFileSync(snapshotPath, 'existing', 'utf8');

  assert.throws(
    () => assertCanWriteSnapshot(snapshotPath, { overwrite: false }),
    /--overwrite/
  );
  assert.doesNotThrow(() => assertCanWriteSnapshot(snapshotPath, { overwrite: true }));
  assert.equal(fs.readFileSync(snapshotPath, 'utf8'), 'existing');
});

test('snapshot metadata includes bytes sha256 and marker checks', () => {
  const metadata = buildSnapshotMetadata({
    fetchedAt: '2026-05-10T12:00:00.000Z',
    sourceUrl: 'https://www.spar.at/aktionen/steiermark',
    status: 200,
    contentType: 'text/html; charset=utf-8',
    html: plausibleSparHtml,
  });

  assert.equal(metadata.bytes, Buffer.byteLength(plausibleSparHtml, 'utf8'));
  assert.equal(metadata.sha256, sha256(plausibleSparHtml));
  assert.equal(metadata.markerChecks.hasSteiermark, true);
  assert.equal(metadata.markerChecks.hasFlyerLink, true);
});

test('writeSnapshotFiles writes HTML and metadata only after validation', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spar-snapshot-write-test-'));
  const snapshotPath = path.join(tempDir, 'snapshot.html');
  const metaPath = path.join(tempDir, 'snapshot.meta.json');

  const result = await writeSnapshotFiles({
    html: plausibleSparHtml,
    status: 200,
    contentType: 'text/html; charset=utf-8',
    snapshotPath,
    metaPath,
    fetchedAt: '2026-05-10T12:00:00.000Z',
  });

  assert.equal(fs.readFileSync(snapshotPath, 'utf8'), plausibleSparHtml);
  const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  assert.equal(metadata.sha256, sha256(plausibleSparHtml));
  assert.equal(result.metadata.sha256, metadata.sha256);
});
