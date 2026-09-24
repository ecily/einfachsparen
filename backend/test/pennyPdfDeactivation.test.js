const test = require('node:test');
const assert = require('node:assert/strict');

const { RETAILER_DEFINITIONS } = require('../src/services/sources/sourceDefinitions');
const { applySourceSelection, deriveSourceKey } = require('../src/services/crawl/crawlSourceSelection');
const { getScheduledHealthPolicy } = require('../src/services/sources/sourceHealthPolicy');
const { isPublicValidityEligible } = require('../src/services/offers/publicValidity');
const { filterFreshActiveOffers } = require('../src/services/offers/offerRankingService');

const now = new Date('2026-09-24T12:00:00Z');
const pennySources = RETAILER_DEFINITIONS.filter((source) => source.retailerKey === 'penny');
const htmlSource = pennySources.find((source) => source.sourceUrl === 'https://www.penny.at/angebote');
const pdfSource = pennySources.find((source) => source.sourceUrl === 'https://www.penny.at/angebote/flugblaetter');

function currentHtmlOffer(overrides = {}) {
  return {
    retailerKey: 'penny',
    sourceType: 'penny-official-html',
    sourceTypes: ['penny-official-html', 'official-site'],
    sourceUrl: 'https://www.penny.at/angebote/kaffee',
    rawFacts: { sourceType: 'penny-official-html', sourceKey: 'penny-official-site', sourceKind: 'official' },
    validFrom: new Date('2026-09-24T00:00:00Z'),
    validTo: new Date('2026-09-30T23:59:59Z'),
    status: 'active', isActiveNow: true,
    ...overrides,
  };
}

test('PENNY flyer cannot run in full or scoped selection, even with allowDisabled', () => {
  assert.equal(deriveSourceKey(pdfSource), 'penny-official-flyer');
  assert.equal(pdfSource.enabled, false);
  assert.equal(pdfSource.crawlPolicy.disableOfferExtraction, true);
  assert.equal(htmlSource.enabled, undefined);
  assert.equal(applySourceSelection({ sources: pennySources }).selectedSources.includes(htmlSource), true);
  assert.equal(applySourceSelection({ sources: pennySources }).selectedSources.includes(pdfSource), false);
  for (const allowDisabled of [false, true]) {
    const selection = applySourceSelection({ sources: pennySources, sourceKeys: ['penny-official-flyer'], allowDisabled });
    assert.equal(selection.selectedSources.length, 0);
    assert.equal(selection.disabledSources.length, 1);
  }
});

test('disabled PENNY flyer is excluded from scheduled health; HTML remains required', () => {
  assert.equal(getScheduledHealthPolicy(pdfSource).healthCriticality, 'excluded');
  assert.equal(getScheduledHealthPolicy(pdfSource).requiredForScheduledHealth, false);
  assert.equal(getScheduledHealthPolicy(htmlSource).healthCriticality, 'required');
  assert.equal(getScheduledHealthPolicy(htmlSource).requiredForScheduledHealth, true);
});

test('current PENNY HTML remains public while PDF-only and mixed historical lineage fail closed', () => {
  const html = currentHtmlOffer();
  assert.equal(isPublicValidityEligible(html, now).eligible, true);
  const pdfVariants = [
    { sourceType: 'penny-official-pdf', sourceTypes: ['penny-official-pdf', 'official-flyer'] },
    { sourceTypes: ['penny-official-html', 'penny-official-pdf'] },
    { rawFacts: { sourceType: 'penny-official-pdf', sourceKey: 'penny-official-flyer-pdf' } },
    { supportingSources: [{ channel: 'official-flyer', sourceUrl: 'https://issuu.com/pennyat/docs/weekly' }] },
    { evidenceUrls: ['https://www.penny.at/weekly.pdf'] },
  ];
  for (const variant of pdfVariants) {
    const offer = currentHtmlOffer(variant);
    assert.equal(isPublicValidityEligible(offer, now).reasonCode, 'penny-pdf-source-disabled');
    assert.equal(filterFreshActiveOffers([offer], now).length, 0);
  }
});
