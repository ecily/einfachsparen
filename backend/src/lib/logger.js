function log(level, message, payload) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };

  if (payload !== undefined) {
    entry.payload = payload;
  }

  const line = JSON.stringify(entry);

  if (level === 'error') {
    console.error(line);
    return;
  }

  console.log(line);
}

module.exports = {
  info(message, payload) {
    log('info', message, payload);
  },
  warn(message, payload) {
    log('warn', message, payload);
  },
  error(message, payload) {
    log('error', message, payload);
  },
};
