function safePositiveInteger(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : fallback;
}

function killTarget(pid, signal = 'SIGKILL') {
  const targetPid = safePositiveInteger(pid);
  if (!targetPid) {
    process.exitCode = 1;
    return;
  }

  try {
    process.kill(targetPid, signal || 'SIGKILL');
  } catch (_) {
    // The worker may have already exited.
  }
}

process.once('message', (message = {}) => {
  const timeoutMs = safePositiveInteger(message.timeoutMs);
  if (!timeoutMs) {
    process.exitCode = 1;
    return;
  }

  const timer = setTimeout(() => {
    killTarget(message.targetPid, message.signal || 'SIGKILL');
    process.exit(0);
  }, timeoutMs);
});
