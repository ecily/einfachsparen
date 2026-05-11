const { execFileSync } = require('node:child_process');

const packageJson = require('../../package.json');

const PROCESS_STARTED_AT = new Date();
const BUILD_TIME_ENV_KEYS = [
  'BUILD_TIME',
  'BUILD_TIMESTAMP',
  'SOURCE_BUILD_TIME',
  'DO_BUILD_TIME',
  'DIGITALOCEAN_BUILD_TIME',
];
const COMMIT_ENV_KEYS = [
  'GIT_SHA',
  'COMMIT_SHA',
  'SOURCE_VERSION',
  'RENDER_GIT_COMMIT',
  'DO_APP_COMMIT_SHA',
  'DIGITALOCEAN_APP_COMMIT_SHA',
  'DIGITALOCEAN_COMMIT_SHA',
  'VERCEL_GIT_COMMIT_SHA',
];

const DEPLOYMENT_ENV_KEYS = [
  'DEPLOYMENT_ID',
  'RENDER_SERVICE_ID',
  'DO_APP_ID',
  'DIGITALOCEAN_APP_ID',
];

function cleanBuildValue(value) {
  const cleaned = String(value || '').trim();
  return cleaned || '';
}

function readFirstEnvValue(keys, env = process.env) {
  for (const key of keys) {
    const value = cleanBuildValue(env[key]);
    if (value) {
      return { key, value };
    }
  }

  return { key: '', value: '' };
}

function readGitCommitSha({ cwd = process.cwd() } = {}) {
  try {
    return cleanBuildValue(execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1000,
    }));
  } catch (error) {
    return '';
  }
}

function normalizeIsoBuildTime(value) {
  const cleaned = cleanBuildValue(value);

  if (!cleaned) {
    return '';
  }

  const date = new Date(cleaned);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const year = date.getUTCFullYear();

  if (year < 2000) {
    return '';
  }

  return date.toISOString();
}

function buildSafeBuildInfo({ env = process.env, cwd = process.cwd(), gitReader = readGitCommitSha } = {}) {
  const commitEnv = readFirstEnvValue(COMMIT_ENV_KEYS, env);
  const gitCommitSha = commitEnv.value ? '' : gitReader({ cwd });
  const commitSha = commitEnv.value || gitCommitSha || 'unknown';
  const buildTimeEnv = readFirstEnvValue(BUILD_TIME_ENV_KEYS, env);
  const envBuildTime = normalizeIsoBuildTime(buildTimeEnv.value);
  const buildTime = envBuildTime || PROCESS_STARTED_AT.toISOString();
  const deploymentId = readFirstEnvValue(DEPLOYMENT_ENV_KEYS, env).value;

  return {
    packageVersion: packageJson.version || 'unknown',
    commitSha,
    commitShort: commitSha === 'unknown' ? 'unknown' : commitSha.slice(0, 12),
    commitSource: commitEnv.key || (gitCommitSha ? 'git' : 'unknown'),
    buildTime,
    buildTimeSource: envBuildTime ? buildTimeEnv.key : 'process-start-fallback',
    nodeEnv: cleanBuildValue(env.NODE_ENV) || 'development',
    ...(deploymentId ? { deploymentId } : {}),
  };
}

module.exports = {
  BUILD_TIME_ENV_KEYS,
  COMMIT_ENV_KEYS,
  DEPLOYMENT_ENV_KEYS,
  buildSafeBuildInfo,
  readGitCommitSha,
};
