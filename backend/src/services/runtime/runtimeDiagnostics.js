const logger = require('../../lib/logger');
const { buildSafeBuildInfo } = require('../buildInfo');

const ERROR_STACK_LIMIT = 6000;
const ERROR_MESSAGE_LIMIT = 1200;
let cachedProcessBuildInfo = null;

function numberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function compactString(value, maxLength = ERROR_MESSAGE_LIMIT) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function buildMemorySnapshot(memoryUsage = process.memoryUsage()) {
  const memory = typeof memoryUsage === 'function' ? memoryUsage() : memoryUsage;

  return {
    rss: numberOrNull(memory?.rss),
    heapTotal: numberOrNull(memory?.heapTotal),
    heapUsed: numberOrNull(memory?.heapUsed),
    external: numberOrNull(memory?.external),
    arrayBuffers: numberOrNull(memory?.arrayBuffers),
  };
}

function getRuntimeBuildInfo(env = process.env) {
  if (env === process.env) {
    if (!cachedProcessBuildInfo) {
      cachedProcessBuildInfo = buildSafeBuildInfo({ env });
    }
    return cachedProcessBuildInfo;
  }

  return buildSafeBuildInfo({ env });
}

function buildRuntimeSnapshot({
  env = process.env,
  buildInfo = getRuntimeBuildInfo(env),
  pid = process.pid,
  uptimeSeconds = process.uptime(),
  memoryUsage = process.memoryUsage(),
} = {}) {
  return {
    pid,
    uptimeSeconds: Math.round(Number(uptimeSeconds) || 0),
    memoryUsage: buildMemorySnapshot(memoryUsage),
    nodeEnv: compactString(buildInfo?.nodeEnv || env.NODE_ENV || 'development', 80),
    buildTime: buildInfo?.buildTime || null,
    processStartedAt: buildInfo?.processStartedAt || null,
    commitShort: buildInfo?.commitShort || 'unknown',
  };
}

function serializeErrorForRuntimeLog(error) {
  if (!error) {
    return null;
  }

  if (error instanceof Error) {
    return {
      name: compactString(error.name, 120),
      code: compactString(error.code, 120),
      message: compactString(error.message),
      stack: compactString(error.stack, ERROR_STACK_LIMIT),
    };
  }

  return {
    name: typeof error,
    message: compactString(error),
  };
}

function buildCrawlRuntimePayload({
  runId,
  trigger = '',
  progress = {},
  event = '',
} = {}) {
  const stage = compactString(progress?.stage || progress?.progressStage || '', 160);

  return {
    event: compactString(event, 160),
    runId: compactString(runId, 120),
    trigger: compactString(progress?.trigger || trigger, 80),
    progressStage: stage,
    runStatus: compactString(progress?.runStatus || '', 80),
    currentSourceKey: compactString(progress?.currentSourceKey || '', 200),
    currentSourceId: compactString(progress?.currentSourceId || '', 120),
    currentRetailerKey: compactString(progress?.currentRetailerKey || '', 120),
    currentSourceIndex: numberOrNull(progress?.sourceIndex ?? progress?.currentSourceIndex),
    currentSourceCount: numberOrNull(progress?.sourceCount ?? progress?.currentSourceCount),
    currentSourceStartedAt: progress?.currentSourceStartedAt || null,
    sourceStatus: compactString(progress?.sourceStatus || '', 80),
    failureStage: compactString(progress?.failureStage || '', 160),
    finishedSourceCount: numberOrNull(progress?.finishedSourceCount),
    runtime: buildRuntimeSnapshot(),
  };
}

function logBackendRuntimeStarted({ loggerImpl = logger } = {}) {
  loggerImpl.info('Backend runtime started', buildRuntimeSnapshot());
}

function logProcessLifecycleEvent(event, payload = {}, { loggerImpl = logger, level = 'warn' } = {}) {
  const logPayload = {
    event,
    ...buildRuntimeSnapshot(),
    ...payload,
  };

  const log = typeof loggerImpl[level] === 'function' ? loggerImpl[level] : loggerImpl.warn;
  log.call(loggerImpl, 'Backend process lifecycle event', logPayload);
}

let lifecycleDiagnosticsInstalled = false;

function installProcessLifecycleDiagnostics({ loggerImpl = logger } = {}) {
  if (lifecycleDiagnosticsInstalled) {
    return false;
  }

  lifecycleDiagnosticsInstalled = true;

  process.on('SIGTERM', () => {
    logProcessLifecycleEvent('SIGTERM', {}, { loggerImpl, level: 'warn' });
  });

  process.on('SIGINT', () => {
    logProcessLifecycleEvent('SIGINT', {}, { loggerImpl, level: 'warn' });
  });

  process.on('uncaughtException', (error) => {
    logProcessLifecycleEvent('uncaughtException', {
      error: serializeErrorForRuntimeLog(error),
    }, { loggerImpl, level: 'error' });
    process.exitCode = 1;
    setImmediate(() => process.exit(1));
  });

  process.on('unhandledRejection', (reason) => {
    logProcessLifecycleEvent('unhandledRejection', {
      error: serializeErrorForRuntimeLog(reason),
    }, { loggerImpl, level: 'error' });
    process.exitCode = 1;
  });

  process.on('beforeExit', (code) => {
    logProcessLifecycleEvent('beforeExit', { code }, { loggerImpl, level: 'warn' });
  });

  process.on('exit', (code) => {
    logProcessLifecycleEvent('exit', { code }, { loggerImpl, level: 'warn' });
  });

  return true;
}

function logCrawlRuntimeProgress({ runId, trigger = '', progress = {}, loggerImpl = logger } = {}) {
  if (!runId) {
    return;
  }

  loggerImpl.info('CrawlRun runtime progress', buildCrawlRuntimePayload({
    runId,
    trigger,
    progress,
    event: 'progress',
  }));
}

function logCrawlRuntimeHeartbeat({ runId, trigger = '', progress = {}, loggerImpl = logger } = {}) {
  if (!runId) {
    return;
  }

  loggerImpl.info('CrawlRun runtime heartbeat', buildCrawlRuntimePayload({
    runId,
    trigger,
    progress,
    event: 'heartbeat',
  }));
}

module.exports = {
  buildCrawlRuntimePayload,
  buildMemorySnapshot,
  buildRuntimeSnapshot,
  installProcessLifecycleDiagnostics,
  logBackendRuntimeStarted,
  logCrawlRuntimeHeartbeat,
  logCrawlRuntimeProgress,
  logProcessLifecycleEvent,
  serializeErrorForRuntimeLog,
};
