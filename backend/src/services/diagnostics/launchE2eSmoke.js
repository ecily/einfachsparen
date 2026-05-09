const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const API_ENDPOINTS = [
  { key: 'health', path: '/health' },
  { key: 'ranking-kaffee', path: '/offers/ranking?q=kaffee' },
  { key: 'ranking-butter', path: '/offers/ranking?q=butter' },
  { key: 'ranking-reis', path: '/offers/ranking?q=reis' },
  { key: 'ranking-milch', path: '/offers/ranking?q=milch' },
  { key: 'ranking-waschmittel', path: '/offers/ranking?q=waschmittel' },
  { key: 'filters-retailers', path: '/filters/retailers' },
  { key: 'filters-categories', path: '/filters/categories' },
];

const RISKY_CLAIMS = [
  'alle Angebote',
  'bester Preis',
  'garantiert',
  'immer günstigster',
  'immer guenstigster',
  'vollständig',
  'vollstaendig',
  'alle Märkte',
  'alle Maerkte',
  'kaufgut.at',
  'einfachsparen',
  'Alpha',
  'APK',
];

const TEXT_EXTENSIONS = new Set([
  '.bat',
  '.css',
  '.gradle',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.kt',
  '.md',
  '.properties',
  '.txt',
  '.xml',
]);

const SKIP_DIRS = new Set([
  '.git',
  '.gradle',
  '.cxx',
  '.venv-ocr',
  'build',
  'coverage',
  'diagnostics',
  'dist',
  'node_modules',
  'scripts',
  'test',
  'tmp',
]);

const SKIP_FILES = new Set([
  'package-lock.json',
  'coverage-report.json',
  'coverage-report-after-category-fix.json',
  'coverage-report-after-targeted-reclassify.json',
]);

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function parseArgs(argv = []) {
  const options = {
    json: false,
    liveApi: '',
    timeoutMs: 180000,
    rootDir: path.resolve(__dirname, '..', '..', '..', '..'),
    backendDir: path.resolve(__dirname, '..', '..', '..'),
  };

  for (const arg of argv) {
    if (arg === '--json') {
      options.json = true;
      continue;
    }

    if (arg.startsWith('--live-api=')) {
      options.liveApi = normalizeBaseUrl(arg.slice('--live-api='.length));
      continue;
    }

    if (arg.startsWith('--timeout-ms=')) {
      const timeoutMs = Number(arg.slice('--timeout-ms='.length));
      if (Number.isInteger(timeoutMs) && timeoutMs >= 10000 && timeoutMs <= 900000) {
        options.timeoutMs = timeoutMs;
      }
    }
  }

  options.adminDir = path.join(options.rootDir, 'admin');
  options.mobileDir = path.join(options.rootDir, 'mobile');

  return options;
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

async function defaultCommandRunner(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    cwd: options.cwd,
    timeout: options.timeoutMs || 180000,
    maxBuffer: 1024 * 1024 * 40,
    shell: process.platform === 'win32',
    windowsHide: true,
  });

  return {
    ok: true,
    exitCode: 0,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function summarizeCommandOutput(stdout = '', stderr = '') {
  const combined = `${stdout}\n${stderr}`.trim();
  const lines = combined.split(/\r?\n/).filter(Boolean);

  return {
    lineCount: lines.length,
    tail: lines.slice(-30),
  };
}

function parseJsonFromOutput(stdout = '') {
  const text = String(stdout || '').trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (error) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
  }

  return null;
}

async function runBackendCommand({ key, script, args = [], backendDir, timeoutMs, commandRunner }) {
  const commandArgs = ['run', script];
  if (args.length > 0) {
    commandArgs.push('--', ...args);
  }

  try {
    const result = await commandRunner(npmCommand(), commandArgs, { cwd: backendDir, timeoutMs });
    const parsedJson = parseJsonFromOutput(result.stdout);

    return {
      key,
      script,
      ok: true,
      exitCode: result.exitCode ?? 0,
      parsedJson: Boolean(parsedJson),
      summary: summarizeCommandOutput(result.stdout, result.stderr),
      report: parsedJson,
    };
  } catch (error) {
    const stdout = error.stdout || '';
    const stderr = error.stderr || error.message || '';

    return {
      key,
      script,
      ok: false,
      exitCode: error.code ?? 1,
      parsedJson: false,
      error: error.message,
      summary: summarizeCommandOutput(stdout, stderr),
      report: parseJsonFromOutput(stdout),
    };
  }
}

async function runBackendDiagnostics({ backendDir, timeoutMs, commandRunner = defaultCommandRunner } = {}) {
  const commands = [
    { key: 'npmTest', script: 'test' },
    { key: 'launchQualitySmoke', script: 'diagnose:launch-quality-smoke', args: ['--json'] },
    { key: 'marketCoverage', script: 'diagnose:market-coverage', args: ['--json'] },
    { key: 'sourcePriority', script: 'diagnose:source-priority' },
    { key: 'validityCoverage', script: 'diagnose:validity-coverage' },
  ];
  const results = {};

  for (const command of commands) {
    results[command.key] = await runBackendCommand({
      ...command,
      backendDir,
      timeoutMs,
      commandRunner,
    });
  }

  return results;
}

function classifyApiPayload(endpoint, payload) {
  if (!payload || typeof payload !== 'object') {
    return { status: 'fail', reason: 'response is not a JSON object' };
  }

  if (endpoint.key === 'health') {
    return payload.ok || payload.status === 'ok'
      ? { status: 'pass', reason: 'health endpoint returned ok' }
      : { status: 'fail', reason: 'health endpoint did not return ok' };
  }

  if (endpoint.key.startsWith('ranking-')) {
    const resultCount = Number(payload.summary?.resultCount ?? payload.rankedOffers?.length ?? payload.rankedGroups?.length ?? 0);
    if (resultCount > 0) {
      return { status: 'pass', reason: 'ranking returned visible results', resultCount };
    }

    return { status: 'watch', reason: 'ranking endpoint responded but returned no visible results', resultCount: 0 };
  }

  if (endpoint.key === 'filters-retailers') {
    const count = Array.isArray(payload.retailers) ? payload.retailers.length : 0;
    return count > 0
      ? { status: 'pass', reason: 'retailer filters returned items', resultCount: count }
      : { status: 'watch', reason: 'retailer filters responded but returned no items', resultCount: count };
  }

  if (endpoint.key === 'filters-categories') {
    const count = Array.isArray(payload.categories) ? payload.categories.length : 0;
    return count > 0
      ? { status: 'pass', reason: 'category filters returned items', resultCount: count }
      : { status: 'watch', reason: 'category filters responded but returned no items', resultCount: count };
  }

  return { status: 'watch', reason: 'endpoint has no classifier' };
}

async function defaultHttpGetJson(url) {
  const response = await fetch(url, { method: 'GET' });
  let payload = null;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  return {
    ok: response.ok,
    statusCode: response.status,
    payload,
  };
}

async function runApiSmoke({ liveApi = '', httpGetJson = defaultHttpGetJson } = {}) {
  const baseUrl = normalizeBaseUrl(liveApi);

  if (!baseUrl) {
    return {
      mode: 'skipped',
      liveApiRequired: true,
      note: 'No live API checks were executed. Pass --live-api=https://www.kaufklug.at/api to opt in.',
      endpoints: API_ENDPOINTS.map((endpoint) => ({
        ...endpoint,
        status: 'skipped',
        reason: 'live API flag not provided',
      })),
    };
  }

  const endpoints = [];
  for (const endpoint of API_ENDPOINTS) {
    const url = `${baseUrl}${endpoint.path}`;
    try {
      const response = await httpGetJson(url);
      const classification = response.ok
        ? classifyApiPayload(endpoint, response.payload)
        : { status: 'fail', reason: `HTTP ${response.statusCode}`, statusCode: response.statusCode };

      endpoints.push({
        ...endpoint,
        url,
        statusCode: response.statusCode,
        ...classification,
      });
    } catch (error) {
      endpoints.push({
        ...endpoint,
        url,
        status: 'fail',
        reason: error.message,
      });
    }
  }

  return {
    mode: 'live-api',
    baseUrl,
    endpoints,
    passCount: endpoints.filter((endpoint) => endpoint.status === 'pass').length,
    watchCount: endpoints.filter((endpoint) => endpoint.status === 'watch').length,
    failCount: endpoints.filter((endpoint) => endpoint.status === 'fail').length,
  };
}

function safeReadJson(filePath) {
  try {
    return {
      ok: true,
      value: JSON.parse(fs.readFileSync(filePath, 'utf8')),
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
      value: null,
    };
  }
}

function fileExists(...parts) {
  return fs.existsSync(path.join(...parts));
}

function readTextIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function listTextFiles(rootDir) {
  const files = [];

  function visit(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          visit(path.join(dir, entry.name));
        }
        continue;
      }

      if (!entry.isFile() || SKIP_FILES.has(entry.name)) {
        continue;
      }

      const filePath = path.join(dir, entry.name);
      if (TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(filePath);
      }
    }
  }

  visit(rootDir);
  return files;
}

function findRiskyClaims({ roots = [], rootDir = process.cwd(), terms = RISKY_CLAIMS } = {}) {
  const normalizedTerms = terms.map((term) => ({
    term,
    needle: term.toLowerCase(),
  }));
  const matches = [];

  for (const scanRoot of roots) {
    for (const filePath of listTextFiles(scanRoot)) {
      const relativePath = path.relative(rootDir, filePath).replace(/\\/g, '/');
      const lines = readTextIfExists(filePath).split(/\r?\n/);

      lines.forEach((line, index) => {
        const lowerLine = line.toLowerCase();
        const foundTerms = normalizedTerms
          .filter((item) => lowerLine.includes(item.needle))
          .map((item) => item.term);

        if (foundTerms.length > 0) {
          matches.push({
            file: relativePath,
            line: index + 1,
            terms: [...new Set(foundTerms)],
            excerpt: line.trim().slice(0, 240),
          });
        }
      });
    }
  }

  return matches;
}

function checkWebReadiness({ adminDir, rootDir }) {
  const packageJsonPath = path.join(adminDir, 'package.json');
  const packageJson = safeReadJson(packageJsonPath);
  const scripts = packageJson.value?.scripts || {};
  const apiText = [
    readTextIfExists(path.join(adminDir, 'src', 'api.js')),
    readTextIfExists(path.join(adminDir, 'src', 'utils', 'apiBase.js')),
  ].join('\n');

  return {
    packageReadable: packageJson.ok,
    packageName: packageJson.value?.name || '',
    scripts: {
      build: Boolean(scripts.build),
      lint: Boolean(scripts.lint),
      test: Boolean(scripts.test),
      dev: Boolean(scripts.dev),
    },
    apiBase: {
      usesApiPath: apiText.includes('/api'),
      usesEnv: /VITE_API_BASE/.test(apiText),
      filesChecked: [
        path.relative(rootDir, path.join(adminDir, 'src', 'api.js')).replace(/\\/g, '/'),
        path.relative(rootDir, path.join(adminDir, 'src', 'utils', 'apiBase.js')).replace(/\\/g, '/'),
      ],
    },
    seoLegal: {
      robotsTxt: fileExists(adminDir, 'public', 'robots.txt'),
      sitemapXml: fileExists(adminDir, 'public', 'sitemap.xml'),
      legalComponents: fileExists(adminDir, 'src', 'components', 'legal', 'LegalPages.jsx'),
      indexHtml: fileExists(adminDir, 'index.html'),
    },
  };
}

function checkMobileUpdateProtection({ mobileDir }) {
  const appText = readTextIfExists(path.join(mobileDir, 'App.js'));
  const versionFile = safeReadJson(path.join(mobileDir, 'kaufklug_alpha_version.json'));

  return {
    hasVersionUrlConstant: /ALPHA_VERSION_URL/.test(appText),
    hasApkUrlConstant: /ALPHA_APK_URL/.test(appText),
    hasFetchAlphaVersionInfo: /fetchAlphaVersionInfo/.test(appText),
    hasDismissedUpdateStorage: /DISMISSED_UPDATE_BUILD_STORAGE_KEY/.test(appText),
    versionJsonReadable: versionFile.ok,
    versionJsonKeys: versionFile.ok ? Object.keys(versionFile.value || {}).sort() : [],
  };
}

function checkMobileReadiness({ mobileDir }) {
  const packageJson = safeReadJson(path.join(mobileDir, 'package.json'));
  const appConfig = safeReadJson(path.join(mobileDir, 'app.json'));
  const apiText = readTextIfExists(path.join(mobileDir, 'src', 'config', 'api.js'));
  const expo = appConfig.value?.expo || {};

  return {
    packageReadable: packageJson.ok,
    appConfigReadable: appConfig.ok,
    packageName: expo.android?.package || '',
    expectedPackageName: 'at.kaufklug.app',
    packageNameOk: expo.android?.package === 'at.kaufklug.app',
    version: expo.version || '',
    versionCode: expo.android?.versionCode ?? null,
    scripts: packageJson.value?.scripts || {},
    apiBase: {
      present: /API_BASE_URL/.test(apiText),
      valuePreview: apiText.match(/API_BASE_URL\s*=\s*['"]([^'"]+)['"]/)?.[1] || '',
    },
    updateCheckProtection: checkMobileUpdateProtection({ mobileDir }),
  };
}

function buildEnvironment({ rootDir, backendDir, adminDir, mobileDir, liveApi }) {
  return {
    nodeEnv: process.env.NODE_ENV || '',
    nodeVersion: process.version,
    platform: process.platform,
    rootDir,
    backendDir,
    adminDir,
    mobileDir,
    liveApiEnabled: Boolean(liveApi),
    liveApiBaseUrl: liveApi || '',
  };
}

function pushCommandFailures(blockers, backend = {}) {
  for (const [key, result] of Object.entries(backend)) {
    if (!result.ok) {
      blockers.push({
        area: 'backend',
        key,
        message: `${result.script} failed`,
        detail: result.error || `exitCode=${result.exitCode}`,
      });
    }
  }
}

function addDataQualitySignals({ dataQuality, watchItems, acceptableGaps, requiredBeforePublicLaunch }) {
  const qualityReadiness = dataQuality.launchQuality?.launchReadiness;
  if (!qualityReadiness) return;

  for (const blocker of qualityReadiness.blockers || []) {
    requiredBeforePublicLaunch.push(blocker.recommendation || `Resolve ${blocker.label}`);
  }

  for (const item of qualityReadiness.watchItems || []) {
    watchItems.push({
      area: 'dataQuality',
      key: item.label || item.query,
      message: item.recommendation || 'Launch-quality item remains on watch.',
      reasons: item.failReasons || [],
    });
  }

  for (const item of qualityReadiness.acceptableGaps || []) {
    acceptableGaps.push({
      area: 'dataQuality',
      key: item.label || item.query,
      message: item.scopeLimit || 'Accepted MVP scope gap.',
      reasons: item.failReasons || [],
    });
  }
}

function buildDataQualitySummary(backend = {}) {
  return {
    launchQuality: backend.launchQualitySmoke?.report
      ? {
          summary: backend.launchQualitySmoke.report.summary || null,
          launchReadiness: backend.launchQualitySmoke.report.launchReadiness || null,
        }
      : null,
    marketCoverage: backend.marketCoverage?.report
      ? { summary: backend.marketCoverage.report.summary || null }
      : null,
    sourcePriority: backend.sourcePriority?.report
      ? {
          summary: backend.sourcePriority.report.summary || null,
          duplicateClusterCount: backend.sourcePriority.report.duplicateClusterCount ?? null,
        }
      : null,
    validityCoverage: backend.validityCoverage?.report
      ? { summary: backend.validityCoverage.report.summary || null }
      : null,
  };
}

function buildLaunchReadiness({ backend, api, web, mobile, dataQuality, riskyClaims }) {
  const blockers = [];
  const watchItems = [];
  const acceptableGaps = [];
  const requiredBeforePublicLaunch = [];
  const recommendedBeforePlayStore = [];

  pushCommandFailures(blockers, backend);
  addDataQualitySignals({ dataQuality, watchItems, acceptableGaps, requiredBeforePublicLaunch });

  for (const endpoint of api.endpoints || []) {
    if (endpoint.status === 'fail') {
      blockers.push({
        area: 'api',
        key: endpoint.key,
        message: endpoint.reason,
      });
    } else if (endpoint.status === 'watch') {
      watchItems.push({
        area: 'api',
        key: endpoint.key,
        message: endpoint.reason,
      });
    }
  }

  if (!web.scripts?.build) {
    blockers.push({ area: 'web', key: 'build-script', message: 'Admin/Web build script is missing.' });
  }

  if (!web.scripts?.test) {
    watchItems.push({ area: 'web', key: 'test-script', message: 'Admin/Web has no test script.' });
  }

  if (!web.apiBase?.usesApiPath || !web.apiBase?.usesEnv) {
    watchItems.push({ area: 'web', key: 'api-base', message: 'Admin/Web API base should keep /api and env handling explicit.' });
  }

  if (!mobile.packageNameOk) {
    blockers.push({ area: 'mobile', key: 'package-name', message: `Expected package name at.kaufklug.app, got ${mobile.packageName || 'missing'}.` });
  }

  if (!mobile.updateCheckProtection?.hasVersionUrlConstant || !mobile.updateCheckProtection?.hasFetchAlphaVersionInfo) {
    recommendedBeforePlayStore.push('Manually verify mobile update-check URL/version JSON logic before Play Store preparation.');
  }

  if (riskyClaims.length > 0) {
    watchItems.push({
      area: 'claims',
      key: 'risky-public-text',
      message: `${riskyClaims.length} risky claim/text matches found; review manually before public MVP.`,
    });
    requiredBeforePublicLaunch.push('Review risky public claims and legacy terms found by the smoke text scan.');
  }

  if (api.mode === 'skipped') {
    watchItems.push({
      area: 'api',
      key: 'live-api-skipped',
      message: 'Live API smoke was skipped because --live-api was not provided.',
    });
  }

  const uniqueRequired = [...new Set(requiredBeforePublicLaunch.filter(Boolean))];
  const uniqueRecommended = [...new Set(recommendedBeforePlayStore.filter(Boolean))];

  return {
    status: blockers.length > 0 ? 'not_ready' : (watchItems.length > 0 ? 'watch' : 'ready'),
    blockers,
    watchItems,
    acceptableGaps,
    requiredBeforePublicLaunch: uniqueRequired,
    recommendedBeforePlayStore: uniqueRecommended,
  };
}

async function runLaunchE2eSmoke({
  rootDir,
  backendDir,
  adminDir,
  mobileDir,
  liveApi = '',
  timeoutMs = 180000,
  commandRunner = defaultCommandRunner,
  httpGetJson = defaultHttpGetJson,
} = {}) {
  const checkedAt = new Date().toISOString();
  const backend = await runBackendDiagnostics({ backendDir, timeoutMs, commandRunner });
  const api = await runApiSmoke({ liveApi, httpGetJson });
  const web = checkWebReadiness({ adminDir, rootDir });
  const mobile = checkMobileReadiness({ mobileDir });
  const riskyClaims = findRiskyClaims({
    roots: [backendDir, adminDir, mobileDir],
    rootDir,
  });
  const dataQuality = buildDataQualitySummary(backend);
  const launchReadiness = buildLaunchReadiness({
    backend,
    api,
    web,
    mobile,
    dataQuality,
    riskyClaims,
  });

  return {
    checkedAt,
    readOnly: true,
    mutatedCollections: [],
    environment: buildEnvironment({ rootDir, backendDir, adminDir, mobileDir, liveApi }),
    backend,
    api,
    web,
    mobile,
    dataQuality,
    claims: {
      riskyTerms: RISKY_CLAIMS,
      matchCount: riskyClaims.length,
      matches: riskyClaims,
    },
    launchReadiness,
  };
}

module.exports = {
  API_ENDPOINTS,
  RISKY_CLAIMS,
  buildDataQualitySummary,
  buildLaunchReadiness,
  checkMobileReadiness,
  checkMobileUpdateProtection,
  checkWebReadiness,
  classifyApiPayload,
  findRiskyClaims,
  parseArgs,
  runApiSmoke,
  runBackendDiagnostics,
  runLaunchE2eSmoke,
};
