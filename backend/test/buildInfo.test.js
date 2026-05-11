const assert = require('node:assert/strict');
const test = require('node:test');

const { buildSafeBuildInfo } = require('../src/services/buildInfo');

test('buildSafeBuildInfo uses safe env commit metadata and redacts by omission', () => {
  const info = buildSafeBuildInfo({
    cwd: process.cwd(),
    env: {
      NODE_ENV: 'production',
      GIT_SHA: 'abcdef1234567890',
      BUILD_TIME: '2026-05-11T06:00:00.000Z',
      DEPLOYMENT_ID: 'deploy-123',
      MONGO_URI: 'must-not-appear',
      ADMIN_API_KEY: 'must-not-appear',
    },
    gitReader: () => '',
  });

  assert.equal(info.packageVersion, '1.0.0');
  assert.equal(info.commitSha, 'abcdef1234567890');
  assert.equal(info.commitShort, 'abcdef123456');
  assert.equal(info.buildTime, '2026-05-11T06:00:00.000Z');
  assert.equal(info.nodeEnv, 'production');
  assert.equal(info.deploymentId, 'deploy-123');

  const serialized = JSON.stringify(info);
  assert.doesNotMatch(serialized, /MONGO_URI|ADMIN_API_KEY|must-not-appear/);
});

test('buildSafeBuildInfo falls back to unknown when env and git are unavailable', () => {
  const info = buildSafeBuildInfo({
    cwd: process.cwd(),
    env: { NODE_ENV: 'test' },
    gitReader: () => '',
  });

  assert.equal(info.commitSha, 'unknown');
  assert.equal(info.commitShort, 'unknown');
  assert.equal(info.nodeEnv, 'test');
  assert.ok(info.buildTime);
});
