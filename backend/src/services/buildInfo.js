const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const packageJson = require('../../package.json');

const COMMIT_ENV_KEYS = [
  'GIT_SHA',
  'COMMIT_SHA',
  'SOURCE_VERSION',
  'RENDER_GIT_COMMIT',
  'DO_APP_COMMIT_SHA',
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
      return value;
    }
  }

  return '';
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

function readPackageBuildTime({ cwd = process.cwd() } = {}) {
  try {
    const stat = fs.statSync(path.resolve(cwd, 'package.json'));
    return stat.mtime.toISOString();
  } catch (error) {
    return 'unknown';
  }
}

function buildSafeBuildInfo({ env = process.env, cwd = process.cwd(), gitReader = readGitCommitSha } = {}) {
  const commitSha = readFirstEnvValue(COMMIT_ENV_KEYS, env) || gitReader({ cwd }) || 'unknown';
  const deploymentId = readFirstEnvValue(DEPLOYMENT_ENV_KEYS, env);

  return {
    packageVersion: packageJson.version || 'unknown',
    commitSha,
    commitShort: commitSha === 'unknown' ? 'unknown' : commitSha.slice(0, 12),
    buildTime: cleanBuildValue(env.BUILD_TIME) || readPackageBuildTime({ cwd }),
    nodeEnv: cleanBuildValue(env.NODE_ENV) || 'development',
    ...(deploymentId ? { deploymentId } : {}),
  };
}

module.exports = {
  COMMIT_ENV_KEYS,
  DEPLOYMENT_ENV_KEYS,
  buildSafeBuildInfo,
  readGitCommitSha,
};
