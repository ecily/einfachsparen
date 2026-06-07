const assert = require('node:assert/strict');
const test = require('node:test');

const { RETAILER_DEFINITIONS } = require('../src/services/sources/sourceDefinitions');

const DEAD_AKTIONSFINDER_PV_URLS = [
  'https://www.aktionsfinder.at/pv/spar/',
  'https://www.aktionsfinder.at/pv/eurospar/',
  'https://www.aktionsfinder.at/pv/interspar/',
  'https://www.aktionsfinder.at/pv/lidl/',
  'https://www.aktionsfinder.at/pv/penny/',
  'https://www.aktionsfinder.at/pv/dm-drogerie-markt/',
  'https://www.aktionsfinder.at/pv/pagro-libro/',
  'https://www.aktionsfinder.at/pv/bipa/',
  'https://www.aktionsfinder.at/pv/hofer/',
  'https://www.aktionsfinder.at/pv/billa/',
  'https://www.aktionsfinder.at/pv/billa-plus/',
];

test('dead Aktionsfinder /pv fallback sources stay disabled until a replacement structure is proven', () => {
  const definitionsByUrl = new Map(RETAILER_DEFINITIONS.map((definition) => [definition.sourceUrl, definition]));

  for (const sourceUrl of DEAD_AKTIONSFINDER_PV_URLS) {
    const definition = definitionsByUrl.get(sourceUrl);

    assert.ok(definition, `${sourceUrl} source definition exists`);
    assert.equal(definition.channel, 'aggregator');
    assert.equal(definition.enabled, false);
    assert.equal(definition.latestStatus, 'inactive');
    assert.equal(definition.disabledReason, 'disabled-unreliable-source');
    assert.match(definition.notes, /404/);
    assert.match(definition.notes, /Ersatzstruktur|replacement/i);
  }
});
