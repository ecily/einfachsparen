const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const mongoose = require('mongoose');
const {
  REAL_SNAPSHOT_HINT,
  buildFixtureDiagnostics,
} = require('../scripts/diagnoseSparOfficialParserFixture');
const {
  detectRetailerScope,
  extractSparOfficialFlyerPage,
  parseSparOfficialValidity,
  toAbsoluteUrl,
} = require('../src/services/crawl/sparOfficialFlyerParser');

const fixturePath = path.join(__dirname, 'fixtures', 'spar-official-steiermark-actions.html');
const fixtureHtml = fs.readFileSync(fixturePath, 'utf8');
const missingRealSnapshotPath = path.join(__dirname, 'fixtures', 'missing-real-snapshot-for-test.html');

function extractFixture() {
  return extractSparOfficialFlyerPage(fixtureHtml, {
    sourceUrl: 'https://www.spar.at/aktionen/steiermark',
  });
}

test('parses Austrian SPAR validity ranges conservatively', () => {
  assert.deepEqual(parseSparOfficialValidity('Do., 07.05.26 - Mi., 20.05.26'), {
    validFrom: '2026-05-07',
    validTo: '2026-05-20',
    validityText: 'Do., 07.05.26 - Mi., 20.05.26',
    parseWarnings: [],
  });
  assert.deepEqual(parseSparOfficialValidity('Do., 07.05.26 – Mi., 20.05.26').parseWarnings, []);

  const contextParsed = parseSparOfficialValidity('06.05. - 21.05.', { contextYear: 2026 });
  assert.equal(contextParsed.validFrom, '2026-05-06');
  assert.equal(contextParsed.validTo, '2026-05-21');
  assert.deepEqual(contextParsed.parseWarnings, ['validity-year-inferred-from-context']);

  const missingYear = parseSparOfficialValidity('06.05. - 21.05.');
  assert.equal(missingYear.validFrom, null);
  assert.equal(missingYear.validTo, null);
  assert.deepEqual(missingYear.parseWarnings, ['validity-year-missing']);

  const twoDay = parseSparOfficialValidity('Fr., 8.5. und Sa., 9.5.26');
  assert.equal(twoDay.validFrom, '2026-05-08');
  assert.equal(twoDay.validTo, '2026-05-09');
});

test('detects SPAR retailer scopes without collapsing formats', () => {
  assert.equal(detectRetailerScope('SPAR Flugblatt KW 19'), 'spar');
  assert.equal(detectRetailerScope('EUROSPAR Flugblatt KW 19'), 'eurospar');
  assert.equal(detectRetailerScope('INTERSPAR Monats-Sparer'), 'interspar');
  assert.equal(detectRetailerScope('SPAR-GOURMET Aktionen'), 'spar-gourmet');
});

test('extracts Steiermark flyer cards with PDF links and quality flags', () => {
  const result = extractFixture();

  assert.equal(result.sourceKey, 'spar-official-flyer');
  assert.deepEqual(result.region, { regionKey: 'steiermark', regionName: 'Steiermark' });
  assert.equal(result.flyers.length, 4);
  assert.deepEqual(
    result.flyers.map((flyer) => flyer.retailerScope).sort(),
    ['eurospar', 'interspar', 'spar', 'spar-gourmet'].sort()
  );

  const sparFlyer = result.flyers.find((flyer) => flyer.retailerScope === 'spar');
  assert.equal(sparFlyer.flyerTitle, 'SPAR Flugblatt KW 19');
  assert.equal(sparFlyer.flyerType, 'weekly-flyer');
  assert.equal(sparFlyer.validFrom, '2026-05-07');
  assert.equal(sparFlyer.validTo, '2026-05-20');
  assert.equal(sparFlyer.pdfViewUrl, 'https://flugblatt.spar.at/view/spar-steiermark-kw19');
  assert.equal(sparFlyer.pdfDownloadUrl, 'https://flugblatt.spar.at/download/spar-steiermark-kw19.pdf');
  assert.equal(sparFlyer.quality.hasValidity, true);
  assert.equal(sparFlyer.quality.hasPdfUrl, true);
  assert.equal(sparFlyer.quality.hasRetailerScope, true);
  assert.equal(sparFlyer.quality.hasRegion, true);
});

test('normalizes relative URLs and preserves flugblatt.spar.at links', () => {
  assert.equal(
    toAbsoluteUrl('/downloads/interspar-steiermark-monat.pdf', 'https://www.spar.at/aktionen/steiermark'),
    'https://www.spar.at/downloads/interspar-steiermark-monat.pdf'
  );

  const result = extractFixture();
  const interspar = result.flyers.find((flyer) => flyer.retailerScope === 'interspar');
  const eurospar = result.flyers.find((flyer) => flyer.retailerScope === 'eurospar');

  assert.equal(interspar.pdfDownloadUrl, 'https://www.spar.at/downloads/interspar-steiermark-monat.pdf');
  assert.equal(interspar.pdfViewUrl, '');
  assert.equal(eurospar.pdfViewUrl, 'https://flugblatt.spar.at/view/eurospar-steiermark-kw19');
});

test('extracts direct coffee campaign as raw action candidate only', () => {
  const result = extractFixture();

  assert.deepEqual(result.extractedOffers, []);
  assert.equal(result.actionCandidates.length, 1);

  const coffee = result.actionCandidates[0];
  assert.equal(coffee.title, '-25% auf alle KAFFEES');
  assert.equal(coffee.discountText, '-25%');
  assert.equal(coffee.productScopeText, 'alle KAFFEES');
  assert.equal(coffee.validFrom, '2026-05-07');
  assert.equal(coffee.validTo, '2026-05-20');
  assert.match(coffee.conditionsText, /Ausgenommen Tchibo Cafissimo/);
  assert.equal(coffee.retailerScope, 'spar');
});

test('dedupes identical PDF flyer cards without losing real format variants', () => {
  const result = extractFixture();

  assert.equal(result.flyers.filter((flyer) => flyer.retailerScope === 'spar').length, 1);
  assert.ok(result.flyers.some((flyer) => flyer.retailerScope === 'eurospar'));
  assert.ok(result.flyers.some((flyer) => flyer.retailerScope === 'interspar'));
  assert.ok(result.flyers.some((flyer) => flyer.retailerScope === 'spar-gourmet'));
});

test('extracts real-like SPAR snapshot structures with tolerant selectors', () => {
  const html = `
    <html>
      <body>
        <nav><a aria-current="page" href="/aktionen/steiermark">Steiermark</a></nav>
        <main>
          <section class="cmp-flyout cmp-flyer-teaser" data-testid="flyer-teaser">
            <p class="brand">EUROSPAR</p>
            <h3>Flugblatt KW 19</h3>
            <span class="validity-label">Do., 07.05.26 - Mi., 20.05.26</span>
            <a aria-label="PDF anzeigen EUROSPAR Flugblatt" href="https://flugblatt.spar.at/view/eurospar-real-kw19">Zum Flugblatt</a>
            <a title="PDF herunterladen" href="/downloads/eurospar-real-kw19.pdf">Download</a>
          </section>
          <article class="promotion-tile">
            <h3 class="headline">-25% auf alle KAFFEES</h3>
            <p class="date-range">Do., 07.05.26 - Mi., 20.05.26</p>
            <small class="legal-text">Nur in teilnehmenden SPAR-Maerkten. Ausgenommen Aktionsware.</small>
          </article>
        </main>
      </body>
    </html>
  `;
  const result = extractSparOfficialFlyerPage(html, {
    sourceUrl: 'https://www.spar.at/aktionen/steiermark',
  });

  assert.equal(result.region.regionKey, 'steiermark');
  assert.equal(result.region.regionName, 'Steiermark');
  assert.deepEqual(result.extractedOffers, []);
  assert.equal(result.flyers.length, 1);
  assert.equal(result.flyers[0].retailerScope, 'eurospar');
  assert.equal(result.flyers[0].pdfViewUrl, 'https://flugblatt.spar.at/view/eurospar-real-kw19');
  assert.equal(result.flyers[0].pdfDownloadUrl, 'https://www.spar.at/downloads/eurospar-real-kw19.pdf');
  assert.equal(result.actionCandidates.length, 1);
  assert.equal(result.actionCandidates[0].discountText, '-25%');
  assert.equal(result.actionCandidates[0].productScopeText, 'alle KAFFEES');
});

test('diagnose fixture report handles missing real snapshot without crashing', () => {
  const beforeState = mongoose.connection.readyState;
  const report = buildFixtureDiagnostics({
    syntheticPath: fixturePath,
    realSnapshotPath: missingRealSnapshotPath,
  });

  assert.equal(report.syntheticFixture.available, true);
  assert.equal(report.syntheticFixture.extractedFlyersCount, 4);
  assert.equal(report.syntheticFixture.extractedActionsCount, 1);
  assert.equal(report.syntheticFixture.pdfLinkCount, 6);
  assert.deepEqual(
    report.syntheticFixture.scopes.sort(),
    ['eurospar', 'interspar', 'spar', 'spar-gourmet'].sort()
  );
  assert.equal(report.realSnapshotFixture.available, false);
  assert.equal(report.realSnapshotFixture.manualHint, REAL_SNAPSHOT_HINT);
  assert.match(report.realSnapshotFixture.installHint, /spar-official-steiermark-real-snapshot\.html/);
  assert.equal(mongoose.connection.readyState, beforeState);
  assert.equal(mongoose.connection.readyState, 0);
});

test('parser is fixture-only and does not open a MongoDB connection', () => {
  const beforeState = mongoose.connection.readyState;
  const result = extractFixture();

  assert.equal(result.flyers.length, 4);
  assert.equal(mongoose.connection.readyState, beforeState);
  assert.equal(mongoose.connection.readyState, 0);
});
