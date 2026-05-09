const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  API_ENDPOINTS,
  buildLaunchReadiness,
  checkMobileUpdateProtection,
  classifyApiPayload,
  findRiskyClaims,
  runApiSmoke,
  runLaunchE2eSmoke,
} = require('../src/services/diagnostics/launchE2eSmoke');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'launch-e2e-smoke-'));
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function writeJson(filePath, value) {
  writeFile(filePath, JSON.stringify(value, null, 2));
}

function createMinimalProject(rootDir) {
  const backendDir = path.join(rootDir, 'backend');
  const adminDir = path.join(rootDir, 'admin');
  const mobileDir = path.join(rootDir, 'mobile');

  writeJson(path.join(adminDir, 'package.json'), {
    name: 'admin',
    scripts: {
      build: 'vite build',
      lint: 'eslint .',
    },
  });
  writeFile(path.join(adminDir, 'src', 'api.js'), "export const API_BASE_URL = '/api'\n");
  writeFile(path.join(adminDir, 'src', 'utils', 'apiBase.js'), "const env = import.meta.env.VITE_API_BASE_URL\n");
  writeFile(path.join(adminDir, 'index.html'), '<html></html>');
  writeFile(path.join(adminDir, 'public', 'robots.txt'), 'User-agent: *');
  writeFile(path.join(adminDir, 'public', 'sitemap.xml'), '<urlset></urlset>');
  writeFile(path.join(adminDir, 'src', 'components', 'legal', 'LegalPages.jsx'), 'export default function LegalPages() { return null }\n');

  writeJson(path.join(mobileDir, 'package.json'), {
    name: 'mobile',
    scripts: {
      start: 'expo start',
    },
  });
  writeJson(path.join(mobileDir, 'app.json'), {
    expo: {
      version: '2026.05.09-1',
      android: {
        package: 'at.kaufklug.app',
        versionCode: 2026050901,
      },
    },
  });
  writeFile(path.join(mobileDir, 'src', 'config', 'api.js'), "export const API_BASE_URL = 'https://example.test/api'\n");
  writeFile(path.join(mobileDir, 'App.js'), `
    const ALPHA_VERSION_URL = 'https://example.test/kaufklug_alpha_version.json';
    const ALPHA_APK_URL = 'https://example.test/kaufklug_alpha.apk';
    const DISMISSED_UPDATE_BUILD_STORAGE_KEY = 'dismissed';
    async function fetchAlphaVersionInfo() { return null; }
  `);
  writeJson(path.join(mobileDir, 'kaufklug_alpha_version.json'), {
    versionCode: 2026050901,
    apkUrl: 'https://example.test/kaufklug_alpha.apk',
  });

  fs.mkdirSync(backendDir, { recursive: true });

  return { backendDir, adminDir, mobileDir };
}

test('launch e2e smoke keeps a read-only contract', async () => {
  const rootDir = makeTempDir();
  const dirs = createMinimalProject(rootDir);
  const calls = [];
  const commandRunner = async (command, args) => {
    calls.push({ command, args });
    const script = args[1];
    if (script === 'diagnose:launch-quality-smoke') {
      return {
        stdout: JSON.stringify({
          summary: { watchCount: 0 },
          launchReadiness: {
            status: 'ready',
            blockers: [],
            watchItems: [],
            acceptableGaps: [],
          },
        }),
        stderr: '',
      };
    }

    return { stdout: 'ok', stderr: '' };
  };

  const report = await runLaunchE2eSmoke({
    rootDir,
    ...dirs,
    commandRunner,
  });

  assert.equal(report.readOnly, true);
  assert.deepEqual(report.mutatedCollections, []);
  assert.equal(calls.length, 5);
  assert.equal(report.api.mode, 'skipped');
});

test('API smoke does not execute network checks without live-api flag', async () => {
  let called = false;
  const report = await runApiSmoke({
    httpGetJson: async () => {
      called = true;
      return { ok: true, statusCode: 200, payload: {} };
    },
  });

  assert.equal(called, false);
  assert.equal(report.mode, 'skipped');
  assert.equal(report.endpoints.length, API_ENDPOINTS.length);
  assert.ok(report.endpoints.every((endpoint) => endpoint.status === 'skipped'));
});

test('API smoke executes checks only with live-api flag and classifies results', async () => {
  const urls = [];
  const report = await runApiSmoke({
    liveApi: 'https://www.kaufklug.at/api/',
    httpGetJson: async (url) => {
      urls.push(url);
      if (url.includes('/offers/ranking?q=reis')) {
        return { ok: true, statusCode: 200, payload: { summary: { resultCount: 0 }, rankedOffers: [] } };
      }
      if (url.includes('/filters/retailers')) {
        return { ok: true, statusCode: 200, payload: { retailers: [{ retailerKey: 'hofer' }] } };
      }
      if (url.includes('/filters/categories')) {
        return { ok: true, statusCode: 200, payload: { categories: [{ key: 'milch' }] } };
      }
      if (url.includes('/health')) {
        return { ok: true, statusCode: 200, payload: { ok: true } };
      }
      return { ok: true, statusCode: 200, payload: { summary: { resultCount: 3 }, rankedOffers: [{ id: 'a' }] } };
    },
  });

  assert.equal(report.mode, 'live-api');
  assert.equal(urls.length, API_ENDPOINTS.length);
  assert.equal(report.endpoints.find((endpoint) => endpoint.key === 'ranking-reis').status, 'watch');
  assert.equal(report.failCount, 0);
});

test('risky claim detection reports file and line without changing files', () => {
  const rootDir = makeTempDir();
  const filePath = path.join(rootDir, 'admin', 'src', 'Claim.jsx');
  writeFile(filePath, 'export const claim = "Garantiert bester Preis und alle Angebote";\n');

  const matches = findRiskyClaims({
    roots: [path.join(rootDir, 'admin')],
    rootDir,
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0].file, 'admin/src/Claim.jsx');
  assert.equal(matches[0].line, 1);
  assert.ok(matches[0].terms.includes('bester Preis'));
  assert.ok(matches[0].terms.includes('garantiert'));
});

test('launch status aggregation returns not_ready for blockers and watch without blockers', () => {
  const base = {
    backend: {
      npmTest: { ok: true },
    },
    api: { mode: 'skipped', endpoints: [] },
    web: {
      scripts: { build: true, test: false },
      apiBase: { usesApiPath: true, usesEnv: true },
    },
    mobile: {
      packageNameOk: true,
      updateCheckProtection: {
        hasVersionUrlConstant: true,
        hasFetchAlphaVersionInfo: true,
      },
    },
    dataQuality: {
      launchQuality: {
        launchReadiness: {
          blockers: [],
          watchItems: [],
          acceptableGaps: [],
        },
      },
    },
    riskyClaims: [],
  };

  const watch = buildLaunchReadiness(base);
  assert.equal(watch.status, 'watch');
  assert.ok(watch.watchItems.some((item) => item.key === 'test-script'));

  const notReady = buildLaunchReadiness({
    ...base,
    backend: {
      npmTest: { ok: false, script: 'test', error: 'tests failed' },
    },
  });
  assert.equal(notReady.status, 'not_ready');
  assert.ok(notReady.blockers.some((item) => item.key === 'npmTest'));
});

test('mobile update-check protection signal detects existing version JSON logic', () => {
  const rootDir = makeTempDir();
  const mobileDir = path.join(rootDir, 'mobile');
  writeFile(path.join(mobileDir, 'App.js'), `
    const ALPHA_VERSION_URL = 'https://example.test/version.json';
    const ALPHA_APK_URL = 'https://example.test/app.apk';
    const DISMISSED_UPDATE_BUILD_STORAGE_KEY = 'dismissed';
    async function fetchAlphaVersionInfo() { return null; }
  `);
  writeJson(path.join(mobileDir, 'kaufklug_alpha_version.json'), {
    versionCode: 1,
  });

  const signal = checkMobileUpdateProtection({ mobileDir });

  assert.equal(signal.hasVersionUrlConstant, true);
  assert.equal(signal.hasApkUrlConstant, true);
  assert.equal(signal.hasFetchAlphaVersionInfo, true);
  assert.equal(signal.hasDismissedUpdateStorage, true);
  assert.equal(signal.versionJsonReadable, true);
});

test('API payload classifier separates pass watch and fail cases', () => {
  assert.equal(classifyApiPayload({ key: 'health' }, { ok: true }).status, 'pass');
  assert.equal(classifyApiPayload({ key: 'ranking-kaffee' }, { summary: { resultCount: 2 } }).status, 'pass');
  assert.equal(classifyApiPayload({ key: 'ranking-butter' }, { summary: { resultCount: 0 } }).status, 'watch');
  assert.equal(classifyApiPayload({ key: 'filters-retailers' }, { retailers: [] }).status, 'watch');
  assert.equal(classifyApiPayload({ key: 'health' }, null).status, 'fail');
});
