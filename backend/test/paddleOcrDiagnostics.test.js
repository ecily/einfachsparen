const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildRecommendedPaddleOcrCommand,
  buildWindowsPaddleOcrFallbackHints,
  detectPaddleOcrCliForm,
  summarizePaddleOcrFailure,
  truncateText,
} = require('../src/services/crawl/paddleOcrDiagnostics');

test('detects new PaddleOCR subcommand CLI from help output', () => {
  const cliForm = detectPaddleOcrCliForm(
    'usage: paddleocr [-h] {doc_preprocessor,ocr,doc2md} ...',
    'usage: paddleocr ocr [-h] -i INPUT [--save_path SAVE_PATH] [--lang LANG]',
  );

  assert.equal(cliForm.form, 'subcommand-ocr');
  assert.equal(cliForm.supportsDirectoryInput, true);
  assert.equal(cliForm.supportsSavePath, true);
});

test('detects legacy PaddleOCR image_dir CLI from help output', () => {
  const cliForm = detectPaddleOcrCliForm(
    'usage: paddleocr [-h] --image_dir IMAGE_DIR --use_angle_cls USE_ANGLE_CLS --lang LANG',
    '',
  );

  assert.equal(cliForm.form, 'legacy-image-dir');
  assert.equal(cliForm.legacyImageDirSupported, true);
});

test('builds recommended command for new PaddleOCR CLI', () => {
  const command = buildRecommendedPaddleOcrCommand({
    command: 'C:\\coding\\einfachsparen\\backend\\.venv-ocr\\Scripts\\paddleocr.exe',
    cliForm: { form: 'subcommand-ocr' },
    inputDir: 'C:/tmp/penny',
    outputDir: 'C:/tmp/penny/paddle-output',
  });

  assert.match(command, /paddleocr\.exe" ocr --input "C:\/tmp\/penny"/);
  assert.match(command, /--device cpu --enable_mkldnn False/);
});

test('summarizes known Paddle PIR runtime errors compactly', () => {
  const failure = summarizePaddleOcrFailure({
    code: 1,
    stderr: 'NotImplementedError: ConvertPirAttribute2RuntimeAttribute not support [pir::ArrayAttribute<pir::DoubleAttribute>]',
  });

  assert.equal(failure.ok, false);
  assert.equal(failure.exitCode, 1);
  assert.ok(failure.knownSignals.includes('paddle-pir-runtime-error'));
  assert.match(failure.summary, /ConvertPirAttribute2RuntimeAttribute/);
});

test('adds targeted Windows fallback hints for PIR failures', () => {
  const hints = buildWindowsPaddleOcrFallbackHints({
    cliForm: { form: 'subcommand-ocr' },
    failureSummary: { knownSignals: ['paddle-pir-runtime-error'] },
  });

  assert.ok(hints.some((hint) => hint.includes('PIR-Runtimefehler')));
  assert.ok(hints.some((hint) => hint.includes('paddleocr ocr')));
  assert.ok(hints.some((hint) => hint.includes('Tesseract')));
});

test('truncates noisy command output', () => {
  const truncated = truncateText('x'.repeat(1500), 100);

  assert.equal(truncated.length, 100);
  assert.ok(truncated.endsWith('...'));
});
