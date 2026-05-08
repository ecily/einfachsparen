const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function runExecutable(command, args = [], options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      windowsHide: true,
      ...options,
    });
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      resolve({
        ok: false,
        code: null,
        stdout,
        stderr,
        error,
      });
    });

    child.on('close', (code) => {
      resolve({
        ok: code === 0,
        code,
        stdout,
        stderr,
        error: null,
      });
    });
  });
}

async function checkExecutableAvailable(command) {
  const windowsFallbacks = {
    tesseract: ['C:\\Program Files\\Tesseract-OCR\\tesseract.exe'],
  };
  const checker = process.platform === 'win32'
    ? { command: 'where.exe', args: [command] }
    : { command: 'command', args: ['-v', command], options: { shell: true } };
  const result = await runExecutable(checker.command, checker.args, checker.options || {});
  const fallbackPath = process.platform === 'win32' && !result.ok
    ? (windowsFallbacks[command] || []).find((candidate) => fsSync.existsSync(candidate))
    : '';

  return {
    available: result.ok || Boolean(fallbackPath),
    command,
    path: result.stdout.split(/\r?\n/).find(Boolean) || fallbackPath || '',
    reason: result.ok || fallbackPath ? '' : `${command} wurde nicht im PATH gefunden.`,
  };
}

function buildPopplerInstallHint() {
  return [
    'Windows Git Bash:',
    '1. Poppler for Windows herunterladen, z. B. ueber conda-forge oder einen aktuellen Windows-Build.',
    '2. Den Ordner mit pdftoppm.exe zur PATH-Variable hinzufuegen, z. B. C:\\tools\\poppler\\Library\\bin.',
    '3. Neues Terminal oeffnen und pruefen: pdftoppm -v',
  ].join('\n');
}

async function renderPdfPagesForDiagnostics({
  pdfBuffer,
  outputRoot,
  pageStart = 1,
  pageEnd = 3,
  dpi = 160,
  format = 'png',
  command = 'pdftoppm',
} = {}) {
  const tool = await checkExecutableAvailable(command);

  if (!tool.available) {
    return {
      available: false,
      renderedPages: [],
      tool,
      reason: tool.reason,
      installHint: buildPopplerInstallHint(),
    };
  }

  const startedAt = new Date().toISOString().replace(/[:.]/g, '-');
  const outputDir = path.join(outputRoot, `penny-pdf-ocr-${startedAt}`);
  await fs.mkdir(outputDir, { recursive: true });

  const pdfPath = path.join(outputDir, 'source.pdf');
  const outputPrefix = path.join(outputDir, 'page');
  await fs.writeFile(pdfPath, pdfBuffer);

  const args = [
    '-f',
    String(pageStart),
    '-l',
    String(pageEnd),
    `-${format}`,
    '-r',
    String(dpi),
    pdfPath,
    outputPrefix,
  ];
  const result = await runExecutable(command, args);

  if (!result.ok) {
    return {
      available: false,
      renderedPages: [],
      outputDir,
      tool,
      reason: result.stderr || result.stdout || `${command} exited with code ${result.code}`,
      installHint: buildPopplerInstallHint(),
    };
  }

  const files = await fs.readdir(outputDir);
  const renderedPages = files
    .filter((file) => file.startsWith('page-') && file.endsWith(`.${format}`))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    .map((file, index) => ({
      pageNumber: pageStart + index,
      path: path.join(outputDir, file),
    }));

  return {
    available: true,
    renderedPages,
    outputDir,
    tool,
    command: `${command} ${args.join(' ')}`,
  };
}

module.exports = {
  checkExecutableAvailable,
  renderPdfPagesForDiagnostics,
  buildPopplerInstallHint,
};
