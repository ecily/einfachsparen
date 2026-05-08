const assert = require('node:assert/strict');
const test = require('node:test');
const {
  bboxToPolygon,
  normalizeTesseractConfidence,
  parseTesseractTsv,
  summarizeTesseractFailure,
} = require('../src/services/crawl/tesseractOcrDiagnostics');

test('parses Tesseract TSV word rows into OCR lines', () => {
  const tsv = [
    'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
    '1\t1\t0\t0\t0\t0\t0\t0\t800\t1200\t-1\t',
    '5\t1\t1\t1\t1\t1\t10\t20\t120\t30\t92.5\tKaffee',
    '5\t1\t1\t1\t1\t2\t140\t20\t55\t30\t88\t4.99',
  ].join('\n');

  const lines = parseTesseractTsv(tsv, { pageNumber: 2 });

  assert.equal(lines.length, 2);
  assert.equal(lines[0].text, 'Kaffee');
  assert.equal(lines[0].confidence, 0.925);
  assert.deepEqual(lines[0].bbox, {
    x: 10,
    y: 20,
    width: 120,
    height: 30,
  });
  assert.equal(lines[0].pageNumber, 2);
  assert.deepEqual(lines[1].polygon, [[140, 20], [195, 20], [195, 50], [140, 50]]);
});

test('normalizes Tesseract confidence values defensively', () => {
  assert.equal(normalizeTesseractConfidence('95'), 0.95);
  assert.equal(normalizeTesseractConfidence('88.6789'), 0.8868);
  assert.equal(normalizeTesseractConfidence('-1'), null);
  assert.equal(normalizeTesseractConfidence('not-a-number'), null);
});

test('ignores empty invalid and non-word TSV rows', () => {
  const tsv = [
    'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
    '4\t1\t1\t1\t1\t0\t10\t20\t120\t30\t-1\tline text',
    '5\t1\t1\t1\t1\t1\t10\t20\t0\t30\t90\tZeroWidth',
    '5\t1\t1\t1\t1\t2\t10\t20\t50\t30\t-1\tBadConf',
    '5\t1\t1\t1\t1\t3\t10\t20\t50\t30\t90\t',
    '5\t1\t1\t1\t1\t4\t10\t20\t50\t30\t90\tValid',
  ].join('\n');

  const lines = parseTesseractTsv(tsv, { pageNumber: 1 });

  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, 'Valid');
});

test('returns no OCR lines for malformed TSV', () => {
  assert.deepEqual(parseTesseractTsv('not\tthe\tright\theaders\n1\t2\t3'), []);
  assert.deepEqual(parseTesseractTsv(''), []);
});

test('builds rectangle polygon from bbox', () => {
  assert.deepEqual(bboxToPolygon({
    x: 5,
    y: 10,
    width: 20,
    height: 30,
  }), [[5, 10], [25, 10], [25, 40], [5, 40]]);
});

test('summarizes missing Tesseract language data', () => {
  const failure = summarizeTesseractFailure({
    code: 1,
    stderr: 'Error opening data file C:\\Program Files\\Tesseract-OCR\\tessdata\\deu.traineddata',
  });

  assert.equal(failure.ok, false);
  assert.ok(failure.knownSignals.includes('missing-language-data'));
  assert.match(failure.summary, /deu\.traineddata/);
});
