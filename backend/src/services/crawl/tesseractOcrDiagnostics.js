const { spawn } = require('node:child_process');
const fs = require('node:fs');

const DEFAULT_TESSERACT_LANG = 'deu+eng';
const DEFAULT_TESSERACT_PSM = '6';
const WINDOWS_TESSERACT_PATH = 'C:\\Program Files\\Tesseract-OCR\\tesseract.exe';

function truncateText(value = '', maxLength = 1200) {
  const text = String(value || '').replace(/\x1b\[[0-9;]*m/g, '').trim();

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3)}...`;
}

function runCommand(command, args = [], options = {}) {
  const timeoutMs = options.timeoutMs || 60000;

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      resolve({
        ok: false,
        code: null,
        stdout,
        stderr,
        timedOut,
        error: error.message,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({
        ok: code === 0 && !timedOut,
        code,
        stdout,
        stderr,
        timedOut,
        error: timedOut ? `Command timed out after ${timeoutMs}ms.` : '',
      });
    });
  });
}

function resolveTesseractCommand(command = 'tesseract') {
  if (command !== 'tesseract' || process.platform !== 'win32') {
    return command;
  }

  return fs.existsSync(WINDOWS_TESSERACT_PATH) ? WINDOWS_TESSERACT_PATH : command;
}

function buildTesseractInstallHint() {
  return [
    'Windows Git Bash:',
    '1. Tesseract installieren, z. B. mit winget: winget install UB-Mannheim.TesseractOCR',
    '2. Falls winget das Paket nicht findet: aktuellen Windows-Installer von UB Mannheim verwenden.',
    '3. tesseract.exe zum PATH hinzufuegen, z. B. C:\\Program Files\\Tesseract-OCR.',
    '4. Deutsche Sprachdaten pruefen: tesseract --list-langs | grep deu',
    '5. Falls deu fehlt: deu.traineddata in den tessdata-Ordner legen oder Installer mit Sprachdaten nutzen.',
    '6. Neues Terminal oeffnen und pruefen: tesseract --version',
  ].join('\n');
}

function splitTsvLine(line = '') {
  return String(line).split('\t');
}

function parseFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeTesseractConfidence(value) {
  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    return null;
  }

  return Number((number / 100).toFixed(4));
}

function bboxToPolygon(bbox = {}) {
  const x = parseFiniteNumber(bbox.x);
  const y = parseFiniteNumber(bbox.y);
  const width = parseFiniteNumber(bbox.width);
  const height = parseFiniteNumber(bbox.height);

  return [
    [x, y],
    [x + width, y],
    [x + width, y + height],
    [x, y + height],
  ];
}

function parseTesseractTsv(tsv = '', defaults = {}) {
  const lines = String(tsv || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);

  if (lines.length < 2) {
    return [];
  }

  const headers = splitTsvLine(lines[0]);
  const index = Object.fromEntries(headers.map((header, position) => [header, position]));
  const requiredColumns = ['level', 'left', 'top', 'width', 'height', 'conf', 'text'];

  if (!requiredColumns.every((column) => Object.prototype.hasOwnProperty.call(index, column))) {
    return [];
  }

  return lines.slice(1).flatMap((line) => {
    const columns = splitTsvLine(line);
    const level = parseFiniteNumber(columns[index.level], 0);
    const text = String(columns[index.text] || '').trim();
    const bbox = {
      x: parseFiniteNumber(columns[index.left]),
      y: parseFiniteNumber(columns[index.top]),
      width: parseFiniteNumber(columns[index.width]),
      height: parseFiniteNumber(columns[index.height]),
    };

    if (level !== 5 || !text || bbox.width <= 0 || bbox.height <= 0) {
      return [];
    }

    const confidence = normalizeTesseractConfidence(columns[index.conf]);

    if (confidence === null) {
      return [];
    }

    return [{
      text,
      confidence,
      bbox,
      polygon: bboxToPolygon(bbox),
      pageNumber: defaults.pageNumber || 1,
    }];
  });
}

async function checkTesseractAvailable({ command = 'tesseract', cwd } = {}) {
  const resolvedCommand = resolveTesseractCommand(command);
  const result = await runCommand(resolvedCommand, ['--version'], { cwd, timeoutMs: 10000 });

  return {
    available: result.ok,
    command: resolvedCommand,
    version: result.ok ? truncateText(result.stdout || result.stderr, 300).split(/\r?\n/)[0] : '',
    reason: result.ok ? '' : 'tesseract wurde nicht im PATH gefunden oder konnte nicht gestartet werden.',
    installHint: result.ok ? '' : buildTesseractInstallHint(),
  };
}

async function listTesseractLanguages({ command = 'tesseract', cwd } = {}) {
  const resolvedCommand = resolveTesseractCommand(command);
  const result = await runCommand(resolvedCommand, ['--list-langs'], { cwd, timeoutMs: 10000 });

  if (!result.ok) {
    return [];
  }

  return String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^List of available languages/i.test(line));
}

async function resolveTesseractLanguage({ command = 'tesseract', cwd, requestedLang = DEFAULT_TESSERACT_LANG } = {}) {
  const languages = await listTesseractLanguages({ command, cwd });

  if (!languages.length || !requestedLang.includes('+')) {
    return {
      lang: requestedLang,
      availableLanguages: languages,
      fallbackReason: '',
    };
  }

  const requestedLanguages = requestedLang.split('+').map((item) => item.trim()).filter(Boolean);
  const availableRequested = requestedLanguages.filter((item) => languages.includes(item));

  if (availableRequested.length === requestedLanguages.length) {
    return {
      lang: requestedLang,
      availableLanguages: languages,
      fallbackReason: '',
    };
  }

  if (availableRequested.length > 0) {
    return {
      lang: availableRequested.join('+'),
      availableLanguages: languages,
      fallbackReason: `Tesseract-Sprachdaten fuer ${requestedLanguages.filter((item) => !languages.includes(item)).join('+')} fehlen; Diagnose nutzt ${availableRequested.join('+')}.`,
    };
  }

  return {
    lang: requestedLang,
    availableLanguages: languages,
    fallbackReason: '',
  };
}

function summarizeTesseractFailure(result = {}) {
  const summary = truncateText([result.error, result.stderr, result.stdout].filter(Boolean).join('\n'), 1800);
  const knownSignals = [];

  if (/Failed loading language|Error opening data file|TESSDATA_PREFIX|traineddata/i.test(summary)) {
    knownSignals.push('missing-language-data');
  }

  if (/not recognized|nicht als Name|ENOENT/i.test(summary)) {
    knownSignals.push('command-not-found');
  }

  return {
    ok: false,
    exitCode: result.code ?? null,
    timedOut: Boolean(result.timedOut),
    knownSignals,
    summary: summary || 'Tesseract command failed without stderr/stdout.',
  };
}

async function runTesseractOnRenderedPages({
  renderedPages = [],
  command = 'tesseract',
  lang = process.env.PENNY_PDF_OCR_TESSERACT_LANG || DEFAULT_TESSERACT_LANG,
  psm = process.env.PENNY_PDF_OCR_TESSERACT_PSM || DEFAULT_TESSERACT_PSM,
  cwd,
  timeoutMs = 90000,
} = {}) {
  const availability = await checkTesseractAvailable({ command, cwd });
  const resolvedCommand = availability.command || resolveTesseractCommand(command);

  if (!availability.available) {
    return {
      available: false,
      source: 'tesseract-tsv',
      command: resolvedCommand,
      lang,
      pages: [],
      boxes: [],
      reason: availability.reason,
      installHint: availability.installHint,
      tool: availability,
    };
  }

  if (!renderedPages.length) {
    return {
      available: false,
      source: 'tesseract-tsv',
      command: resolvedCommand,
      lang,
      pages: [],
      boxes: [],
      reason: 'Keine gerenderten PNG-Seiten fuer Tesseract vorhanden.',
      installHint: '',
      tool: availability,
    };
  }

  const pages = [];
  const failures = [];
  const language = await resolveTesseractLanguage({
    command: resolvedCommand,
    cwd,
    requestedLang: lang,
  });

  for (const page of renderedPages) {
    const args = [
      page.path,
      'stdout',
      '-l',
      language.lang,
      '--psm',
      psm,
      'tsv',
    ];
    const result = await runCommand(resolvedCommand, args, { cwd, timeoutMs });

    if (!result.ok) {
      failures.push({
        pageNumber: page.pageNumber,
        failure: summarizeTesseractFailure(result),
      });
      continue;
    }

    const lines = parseTesseractTsv(result.stdout, { pageNumber: page.pageNumber });
    pages.push({
      pageNumber: page.pageNumber,
      sourceImage: page.path,
      lines,
      stderr: truncateText(result.stderr, 500),
    });
  }

  const boxes = pages.flatMap((page) => page.lines.map((line) => ({
    ...line,
    pageNumber: page.pageNumber,
  })));

  return {
    available: boxes.length > 0,
    source: 'tesseract-tsv',
    command: resolvedCommand,
    lang: language.lang,
    requestedLang: lang,
    availableLanguages: language.availableLanguages,
    languageFallbackReason: language.fallbackReason,
    psm,
    pages,
    boxes,
    failures,
    reason: boxes.length > 0 ? language.fallbackReason : ['Tesseract lief, lieferte aber keine normalisierbaren OCR-Boxen.', language.fallbackReason].filter(Boolean).join(' '),
    installHint: failures.some((item) => item.failure.knownSignals.includes('missing-language-data'))
      ? buildTesseractInstallHint()
      : '',
    tool: availability,
  };
}

module.exports = {
  bboxToPolygon,
  buildTesseractInstallHint,
  checkTesseractAvailable,
  normalizeTesseractConfidence,
  parseTesseractTsv,
  runTesseractOnRenderedPages,
  summarizeTesseractFailure,
};
