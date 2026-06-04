const { fork } = require('node:child_process');
const path = require('node:path');

const WORKER_PATH = path.join(__dirname, 'sourceWorkerProcess.js');
const CHILD_EXIT_GRACE_MS = 1500;
const SOURCE_TIMEOUT_ERROR_CODE = 'CRAWL_SOURCE_TIMEOUT';

function createSourceTimeoutError({ source = {}, timeoutMs = 0 } = {}) {
  const error = new Error(`Crawl source process timed out after ${timeoutMs}ms.`);
  error.code = SOURCE_TIMEOUT_ERROR_CODE;
  error.diagnostic = {
    failureStage: 'source-timeout',
    timeoutMs,
    sourceId: String(source?._id || source?.id || ''),
    sourceUrl: source?.sourceUrl || '',
  };
  return error;
}

function createChildFailureError(payload = {}) {
  const error = new Error(payload.message || 'Crawl source process failed.');
  error.code = payload.code || 'CRAWL_SOURCE_PROCESS_FAILED';
  error.stack = payload.stack || error.stack;
  error.diagnostic = payload.diagnostic || {};
  return error;
}

function stopChild(child, signal = 'SIGKILL') {
  if (!child || child.killed) {
    return;
  }

  try {
    child.kill(signal);
  } catch (_) {
    // The process may have exited between timeout and kill.
  }
}

function runSourceInChildProcess({
  source,
  region,
  trigger = 'manual',
  crawlRunId = null,
  timeoutMs,
  forkImpl = fork,
  workerPath = WORKER_PATH,
} = {}) {
  return new Promise((resolve, reject) => {
    const child = forkImpl(workerPath, [], {
      execArgv: [],
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    let settled = false;
    let exitTimer = null;
    const timeoutId = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      stopChild(child);
      exitTimer = setTimeout(() => stopChild(child), CHILD_EXIT_GRACE_MS);
      reject(createSourceTimeoutError({ source, timeoutMs }));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timeoutId);
      if (exitTimer) {
        clearTimeout(exitTimer);
      }
      child.removeAllListeners('message');
      child.removeAllListeners('error');
      child.removeAllListeners('exit');
    }

    child.once('message', (message = {}) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();

      if (message.ok) {
        resolve(message.result || {});
        return;
      }

      reject(createChildFailureError(message.error || {}));
    });

    child.once('error', (error) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(error);
    });

    child.once('exit', (code, signal) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      const error = new Error(`Crawl source process exited before completion (code=${code}, signal=${signal || ''}).`);
      error.code = 'CRAWL_SOURCE_PROCESS_EXIT';
      error.diagnostic = {
        failureStage: 'source-process-exit',
        exitCode: code,
        signal: signal || '',
      };
      reject(error);
    });

    child.send({
      source,
      region,
      trigger,
      crawlRunId,
    });
  });
}

module.exports = {
  runSourceInChildProcess,
  _private: {
    CHILD_EXIT_GRACE_MS,
    SOURCE_TIMEOUT_ERROR_CODE,
    createChildFailureError,
    createSourceTimeoutError,
    stopChild,
  },
};
