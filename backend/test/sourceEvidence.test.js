const assert = require('node:assert/strict');
const test = require('node:test');

const { sanitizeWhitespace, normalizeTitleForMatch } = require('../src/services/crawl/sourceEvidence');

test('sanitizeWhitespace removes control characters from parsed offer titles', () => {
  assert.equal(
    sanitizeWhitespace('BI CARE Cherry Glow Shampoo Limited Edi\u001dtion BIPA'),
    'BI CARE Cherry Glow Shampoo Limited Edition BIPA'
  );
});

test('normalizeTitleForMatch normalizes sanitized titles with control artifacts', () => {
  assert.equal(
    normalizeTitleForMatch('Purina One Katzenfu\u001dtter-Beutel'),
    'purina one katzenfutter beutel'
  );
});
