const assert = require('node:assert/strict');
const test = require('node:test');

const {
  _private: {
    buildCategoryPageLinks,
    buildSupplementalCategoryPageLinks,
    extractCategoryPageLinks,
  },
} = require('../src/services/crawl/aktionsfinderCrawler');

test('Aktionsfinder category discovery keeps linked category pages', () => {
  const html = `
    <a href="/ppcv/lebensmittel/spar/">Lebensmittel</a>
    <a href="/ppcv/getraenke/spar/">Getraenke</a>
    <a href="/ppcv/lebensmittel/spar/">Duplicate</a>
  `;

  assert.deepEqual(
    extractCategoryPageLinks(html, 'https://www.aktionsfinder.at/pv/spar/'),
    [
      'https://www.aktionsfinder.at/ppcv/lebensmittel/spar/',
      'https://www.aktionsfinder.at/ppcv/getraenke/spar/',
    ]
  );
});

test('Aktionsfinder SPAR formats add only targeted reachable coverage categories', () => {
  const html = '<a href="/ppcv/lebensmittel/spar/">Lebensmittel</a>';
  const source = {
    retailerKey: 'spar',
    sourceUrl: 'https://www.aktionsfinder.at/pv/spar/',
  };

  assert.deepEqual(buildSupplementalCategoryPageLinks(source), [
    'https://www.aktionsfinder.at/ppcv/haushalt/spar/',
    'https://www.aktionsfinder.at/ppcv/milchprodukte/spar/',
  ]);

  assert.deepEqual(buildCategoryPageLinks(html, source), [
    'https://www.aktionsfinder.at/ppcv/lebensmittel/spar/',
    'https://www.aktionsfinder.at/ppcv/haushalt/spar/',
    'https://www.aktionsfinder.at/ppcv/milchprodukte/spar/',
  ]);
});

test('Aktionsfinder supplemental category discovery does not broaden non-SPAR retailers', () => {
  const source = {
    retailerKey: 'hofer',
    sourceUrl: 'https://www.aktionsfinder.at/pv/hofer/',
  };

  assert.deepEqual(buildSupplementalCategoryPageLinks(source), []);
  assert.deepEqual(buildCategoryPageLinks('', source), []);
});
