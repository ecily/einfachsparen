const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const DEFAULT_TIMEOUT_MS = 30000;

function quoteCommandPart(value = '') {
  const text = String(value);
  return /[\s\\]/.test(text) ? `"${text}"` : text;
}

function truncateText(value = '', maxLength = 1200) {
  const text = String(value || '').replace(/\x1b\[[0-9;]*m/g, '').trim();

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3)}...`;
}

function runCommand(command, args = [], options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;

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

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (_error) {
    return false;
  }
}

function buildPaddleOcrCandidateCommands({ projectRoot = process.cwd(), command = process.env.PENNY_PDF_OCR_COMMAND } = {}) {
  const candidates = [];

  if (command) {
    candidates.push({ command, source: 'env:PENNY_PDF_OCR_COMMAND' });
  }

  candidates.push({
    command: path.join(projectRoot, '.venv-ocr', 'Scripts', 'paddleocr.exe'),
    source: 'project-venv',
  });
  candidates.push({ command: 'paddleocr', source: 'PATH' });

  return candidates;
}

async function resolvePaddleOcrCommand(options = {}) {
  const candidates = buildPaddleOcrCandidateCommands(options);

  for (const candidate of candidates) {
    const isExplicitPath = candidate.command.includes(path.sep) || candidate.command.endsWith('.exe');
    if (isExplicitPath && !(await fileExists(candidate.command))) {
      continue;
    }

    const result = await runCommand(candidate.command, ['--version'], {
      cwd: options.projectRoot,
      timeoutMs: options.timeoutMs || 10000,
    });

    if (result.ok) {
      return {
        available: true,
        command: candidate.command,
        source: candidate.source,
        versionOutput: truncateText(result.stdout || result.stderr, 300),
      };
    }
  }

  return {
    available: false,
    command: '',
    source: '',
    versionOutput: '',
    reason: 'PaddleOCR CLI wurde weder in .venv-ocr noch im PATH gefunden.',
  };
}

async function readPythonPackageVersion({ pythonCommand, packageName, cwd, timeoutMs = 10000 } = {}) {
  if (!pythonCommand || !packageName) {
    return { available: false, version: '', reason: 'Python command or package name missing.' };
  }

  const code = [
    'import importlib.metadata as metadata',
    `print(metadata.version(${JSON.stringify(packageName)}))`,
  ].join('; ');
  const result = await runCommand(pythonCommand, ['-c', code], { cwd, timeoutMs });

  return {
    available: result.ok,
    version: result.ok ? truncateText(result.stdout, 120) : '',
    reason: result.ok ? '' : summarizePaddleOcrFailure(result).summary,
  };
}

async function detectPairedPythonCommand({ projectRoot = process.cwd() } = {}) {
  const localPython = path.join(projectRoot, '.venv-ocr', 'Scripts', 'python.exe');

  if (await fileExists(localPython)) {
    return { command: localPython, source: 'project-venv' };
  }

  return { command: 'python', source: 'PATH' };
}

function detectPaddleOcrCliForm(helpText = '', ocrHelpText = '') {
  const combined = `${helpText}\n${ocrHelpText}`;
  const hasOcrSubcommand = /\{[^}]*\bocr\b[^}]*\}/.test(helpText) || /paddleocr\s+ocr\b/.test(ocrHelpText);
  const hasInputFlag = /(?:^|\s)(?:-i|--input)\b/.test(ocrHelpText);
  const hasSavePathFlag = /--save_path\b/.test(combined);
  const hasLegacyImageDir = /--image_dir\b/.test(combined);

  if (hasOcrSubcommand || hasInputFlag) {
    return {
      form: 'subcommand-ocr',
      description: 'Neue PaddleOCR-CLI mit Subcommand `ocr`.',
      supportsDirectoryInput: hasInputFlag,
      supportsSavePath: hasSavePathFlag,
      legacyImageDirSupported: hasLegacyImageDir,
    };
  }

  if (hasLegacyImageDir) {
    return {
      form: 'legacy-image-dir',
      description: 'Legacy-PaddleOCR-CLI mit `--image_dir`.',
      supportsDirectoryInput: true,
      supportsSavePath: hasSavePathFlag,
      legacyImageDirSupported: true,
    };
  }

  return {
    form: 'unknown',
    description: 'CLI-Form konnte aus der Hilfeausgabe nicht sicher erkannt werden.',
    supportsDirectoryInput: false,
    supportsSavePath: hasSavePathFlag,
    legacyImageDirSupported: hasLegacyImageDir,
  };
}

function buildRecommendedPaddleOcrCommand({ command = 'paddleocr', cliForm = {}, inputDir = '<diagnostics-dir>', outputDir = '<diagnostics-dir>/paddle-output' } = {}) {
  const quotedCommand = quoteCommandPart(command);
  const quotedInput = `"${inputDir}"`;
  const quotedOutput = `"${outputDir}"`;

  if (cliForm.form === 'legacy-image-dir') {
    return `${quotedCommand} --image_dir ${quotedInput} --use_angle_cls true --lang german`;
  }

  return `${quotedCommand} ocr --input ${quotedInput} --lang german --save_path ${quotedOutput} --device cpu --enable_mkldnn False --use_doc_orientation_classify False --use_doc_unwarping False --use_textline_orientation False`;
}

function summarizePaddleOcrFailure(result = {}) {
  const output = truncateText([result.error, result.stderr, result.stdout].filter(Boolean).join('\n'), 1800);
  const knownSignals = [];

  if (/ConvertPirAttribute2RuntimeAttribute/i.test(output) || /\bpir::/i.test(output)) {
    knownSignals.push('paddle-pir-runtime-error');
  }

  if (/oneDNN|mkldnn/i.test(output)) {
    knownSignals.push('onednn-or-mkldnn');
  }

  if (/No module named|ModuleNotFoundError/i.test(output)) {
    knownSignals.push('python-package-missing');
  }

  if (/not recognized|nicht als Name|ENOENT/i.test(output)) {
    knownSignals.push('command-not-found');
  }

  return {
    ok: false,
    exitCode: result.code ?? null,
    timedOut: Boolean(result.timedOut),
    knownSignals,
    summary: output || 'PaddleOCR command failed without stderr/stdout.',
  };
}

function buildWindowsPaddleOcrFallbackHints({ cliForm = {}, failureSummary = {} } = {}) {
  const hints = [
    'Paddle/PaddleOCR in einer eigenen Projekt-venv pinnen und nicht global mischen.',
    'CPU explizit setzen und oneDNN/MKLDNN testweise deaktivieren: `--device cpu --enable_mkldnn False`.',
    'Falls der PIR-Fehler bleibt: aeltere PaddleOCR/PaddlePaddle-Kombination oder WSL/Docker testen.',
    'Als pragmatischer Diagnose-Fallback: tesseract.js oder externes Tesseract nur fuer OCR-Diagnose nutzen.',
  ];

  if (cliForm.form === 'subcommand-ocr') {
    hints.unshift('Neue CLI-Form verwenden: `paddleocr ocr --input ... --save_path ...`.');
  }

  if ((failureSummary.knownSignals || []).includes('paddle-pir-runtime-error')) {
    hints.unshift('Der erkannte PIR-Runtimefehler deutet auf eine Paddle/PaddleOCR/Windows-Inkompatibilitaet statt auf ein PDF-Renderingproblem hin.');
  }

  return hints;
}

async function buildPaddleOcrCompatibilityReport({ projectRoot = process.cwd(), inputDir = '<diagnostics-dir>', outputDir = '<diagnostics-dir>/paddle-output' } = {}) {
  const commandInfo = await resolvePaddleOcrCommand({ projectRoot });
  const pythonInfo = await detectPairedPythonCommand({ projectRoot });
  const packageVersions = {
    paddleocr: await readPythonPackageVersion({
      pythonCommand: pythonInfo.command,
      packageName: 'paddleocr',
      cwd: projectRoot,
    }),
    paddlepaddle: await readPythonPackageVersion({
      pythonCommand: pythonInfo.command,
      packageName: 'paddlepaddle',
      cwd: projectRoot,
    }),
  };

  if (!commandInfo.available) {
    return {
      available: false,
      command: commandInfo,
      python: pythonInfo,
      packageVersions,
      cliForm: detectPaddleOcrCliForm(),
      recommendedCommand: buildRecommendedPaddleOcrCommand({ inputDir, outputDir }),
      fallbackHints: buildWindowsPaddleOcrFallbackHints(),
    };
  }

  const help = await runCommand(commandInfo.command, ['--help'], { cwd: projectRoot, timeoutMs: 10000 });
  const ocrHelp = await runCommand(commandInfo.command, ['ocr', '--help'], { cwd: projectRoot, timeoutMs: 10000 });
  const cliForm = detectPaddleOcrCliForm(help.stdout || help.stderr, ocrHelp.stdout || ocrHelp.stderr);

  return {
    available: true,
    command: commandInfo,
    python: pythonInfo,
    packageVersions,
    cliForm,
    helpOk: help.ok,
    ocrHelpOk: ocrHelp.ok,
    recommendedCommand: buildRecommendedPaddleOcrCommand({
      command: commandInfo.command,
      cliForm,
      inputDir,
      outputDir,
    }),
    fallbackHints: buildWindowsPaddleOcrFallbackHints({ cliForm }),
  };
}

async function runPaddleOcrCliTrial({ command, cliForm, inputDir, outputDir, cwd, timeoutMs = 120000 } = {}) {
  if (!command || !inputDir || !outputDir) {
    return {
      enabled: false,
      ok: false,
      reason: 'PaddleOCR CLI trial needs command, inputDir and outputDir.',
    };
  }

  const args = cliForm?.form === 'legacy-image-dir'
    ? ['--image_dir', inputDir, '--use_angle_cls', 'true', '--lang', 'german']
    : [
      'ocr',
      '--input',
      inputDir,
      '--lang',
      'german',
      '--save_path',
      outputDir,
      '--device',
      'cpu',
      '--enable_mkldnn',
      'False',
      '--use_doc_orientation_classify',
      'False',
      '--use_doc_unwarping',
      'False',
      '--use_textline_orientation',
      'False',
    ];
  const result = await runCommand(command, args, { cwd, timeoutMs });

  if (!result.ok) {
    const failure = summarizePaddleOcrFailure(result);

    return {
      enabled: true,
      ok: false,
      command: `${quoteCommandPart(command)} ${args.map(quoteCommandPart).join(' ')}`,
      failure,
      fallbackHints: buildWindowsPaddleOcrFallbackHints({ cliForm, failureSummary: failure }),
    };
  }

  return {
    enabled: true,
    ok: true,
    command: `${quoteCommandPart(command)} ${args.map(quoteCommandPart).join(' ')}`,
    stdout: truncateText(result.stdout, 1200),
    stderr: truncateText(result.stderr, 1200),
    outputDir,
  };
}

module.exports = {
  buildPaddleOcrCompatibilityReport,
  buildPaddleOcrCandidateCommands,
  buildRecommendedPaddleOcrCommand,
  buildWindowsPaddleOcrFallbackHints,
  detectPaddleOcrCliForm,
  runPaddleOcrCliTrial,
  summarizePaddleOcrFailure,
  truncateText,
};
