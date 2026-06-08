const net = require('node:net');
const tls = require('node:tls');
const env = require('../config/env');

const DEFAULT_FEEDBACK_EMAIL_TO = 'andreas.franz@ecily.com';
const DEFAULT_FEEDBACK_EMAIL_TIMEOUT_MS = 7000;

function getFeedbackEmailTimeoutMs(envConfig = env) {
  const timeoutMs = Number(envConfig.FEEDBACK_EMAIL_TIMEOUT_MS);
  return Number.isFinite(timeoutMs) && timeoutMs >= 1000 ? timeoutMs : DEFAULT_FEEDBACK_EMAIL_TIMEOUT_MS;
}

function getFeedbackEmailRecipient(envConfig = env) {
  return String(envConfig.FEEDBACK_EMAIL_TO || DEFAULT_FEEDBACK_EMAIL_TO).trim() || DEFAULT_FEEDBACK_EMAIL_TO;
}

function getFeedbackEmailRecipients(envConfig = env) {
  const configuredRecipient = getFeedbackEmailRecipient(envConfig);
  return [...new Set([
    DEFAULT_FEEDBACK_EMAIL_TO,
    configuredRecipient,
  ].filter(Boolean))];
}

function getSmtpConfigStatus(envConfig = env) {
  const missing = [];

  if (!envConfig.SMTP_HOST) missing.push('SMTP_HOST');
  if (!envConfig.SMTP_PORT) missing.push('SMTP_PORT');
  if (!envConfig.SMTP_FROM) missing.push('SMTP_FROM');

  return {
    configured: missing.length === 0,
    missing,
  };
}

function hasSmtpConfig(envConfig = env) {
  return getSmtpConfigStatus(envConfig).configured;
}

function sanitizeHeader(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

function shortError(error) {
  return String(error?.message || error || 'email delivery failed').replace(/\s+/g, ' ').slice(0, 240);
}

function formatDate(value = new Date()) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function buildBetaFeedbackEmailText(feedback = {}) {
  const featureInterests = Array.isArray(feedback.featureInterests) && feedback.featureInterests.length
    ? feedback.featureInterests.join(', ')
    : '-';

  return [
    'Neues kaufklug Beta-Feedback',
    '',
    `Zeitpunkt: ${formatDate(feedback.createdAt)}`,
    `Name: ${feedback.name || '-'}`,
    `E-Mail: ${feedback.email || '-'}`,
    `Feedback-Typ: ${feedback.feedbackType || 'other'}`,
    `Feature-Interessen: ${featureInterests}`,
    `Gewuenschte Maerkte / Haendler: ${feedback.requestedMarkets || '-'}`,
    `Mongo-ID: ${feedback._id || feedback.id || '-'}`,
    '',
    'Nachricht:',
    String(feedback.message || '').trim(),
    '',
    'Gesendet ueber kaufklug.at/feedback',
  ].join('\n');
}

function readLine(socket, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let timer = null;

    function cleanup() {
      if (timer) clearTimeout(timer);
      socket.off('data', handleData);
      socket.off('error', handleError);
      socket.off('end', handleEnd);
    }

    function handleData(chunk) {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      const lastLine = lines[lines.length - 1] || '';

      if (/^\d{3} /.test(lastLine)) {
        cleanup();
        resolve(buffer);
      }
    }

    function handleError(error) {
      cleanup();
      reject(error);
    }

    function handleEnd() {
      cleanup();
      reject(new Error('SMTP connection ended unexpectedly'));
    }

    timer = setTimeout(() => {
      cleanup();
      reject(new Error(`SMTP response timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    socket.on('data', handleData);
    socket.on('error', handleError);
    socket.on('end', handleEnd);
  });
}

async function expectSmtp(socket, expectedCodes, command) {
  const response = await readLine(socket, socket.feedbackTimeoutMs || DEFAULT_FEEDBACK_EMAIL_TIMEOUT_MS);
  const code = Number(response.slice(0, 3));
  const allowedCodes = Array.isArray(expectedCodes) ? expectedCodes : [expectedCodes];

  if (!allowedCodes.includes(code)) {
    throw new Error(`SMTP ${command} failed with ${code}`);
  }

  return response;
}

async function writeSmtp(socket, command, expectedCodes) {
  socket.write(`${command}\r\n`);
  return expectSmtp(socket, expectedCodes, command.split(' ')[0]);
}

function connectSocket({ host, port, secure, timeoutMs = DEFAULT_FEEDBACK_EMAIL_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    const socket = secure
      ? tls.connect({ host, port, servername: host })
      : net.connect({ host, port });
    socket.feedbackTimeoutMs = timeoutMs;

    socket.setTimeout(timeoutMs, () => {
      socket.destroy(new Error(`SMTP socket timeout after ${timeoutMs}ms`));
    });

    socket.once('connect', () => {
      if (!secure) resolve(socket);
    });
    socket.once('secureConnect', () => resolve(socket));
    socket.once('error', reject);
  });
}

function upgradeToTls(socket, host) {
  return new Promise((resolve, reject) => {
    const timeoutMs = socket.feedbackTimeoutMs || DEFAULT_FEEDBACK_EMAIL_TIMEOUT_MS;
    const secureSocket = tls.connect({
      socket,
      servername: host,
    });
    secureSocket.feedbackTimeoutMs = timeoutMs;
    secureSocket.setTimeout(timeoutMs, () => {
      secureSocket.destroy(new Error(`SMTP TLS timeout after ${timeoutMs}ms`));
    });

    secureSocket.once('secureConnect', () => resolve(secureSocket));
    secureSocket.once('error', reject);
  });
}

function buildMimeMessage({ from, to, subject, text }) {
  const safeFrom = sanitizeHeader(from);
  const safeTo = (Array.isArray(to) ? to : [to]).map(sanitizeHeader).filter(Boolean).join(', ');
  const safeSubject = sanitizeHeader(subject);

  return [
    `From: ${safeFrom}`,
    `To: ${safeTo}`,
    `Subject: ${safeSubject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    String(text || ''),
  ].join('\r\n');
}

async function sendSmtpMail({ envConfig = env, subject, text, to: explicitTo }) {
  const host = envConfig.SMTP_HOST;
  const port = Number(envConfig.SMTP_PORT);
  const secure = envConfig.SMTP_SECURE === true || port === 465;
  const requireStartTls = envConfig.SMTP_REQUIRE_TLS === true || (!secure && port === 587);
  const from = envConfig.SMTP_FROM;
  const timeoutMs = getFeedbackEmailTimeoutMs(envConfig);
  const recipients = (Array.isArray(explicitTo) ? explicitTo : (explicitTo ? [explicitTo] : getFeedbackEmailRecipients(envConfig)))
    .map((recipient) => String(recipient || '').trim())
    .filter(Boolean);
  let socket = await connectSocket({ host, port, secure, timeoutMs });
  socket.setTimeout(timeoutMs, () => {
    socket.destroy(new Error(`SMTP socket timeout after ${timeoutMs}ms`));
  });

  try {
    await expectSmtp(socket, 220, 'connect');
    await writeSmtp(socket, `EHLO ${sanitizeHeader(envConfig.SMTP_HELO_NAME || 'kaufklug.at')}`, 250);

    if (requireStartTls) {
      await writeSmtp(socket, 'STARTTLS', 220);
      socket = await upgradeToTls(socket, host);
      socket.feedbackTimeoutMs = timeoutMs;
      await writeSmtp(socket, `EHLO ${sanitizeHeader(envConfig.SMTP_HELO_NAME || 'kaufklug.at')}`, 250);
    }

    if (envConfig.SMTP_USER || envConfig.SMTP_PASS) {
      const auth = Buffer.from(`\u0000${envConfig.SMTP_USER || ''}\u0000${envConfig.SMTP_PASS || ''}`, 'utf8').toString('base64');
      await writeSmtp(socket, `AUTH PLAIN ${auth}`, 235);
    }

    await writeSmtp(socket, `MAIL FROM:<${sanitizeHeader(from)}>`, 250);
    for (const recipient of recipients) {
      await writeSmtp(socket, `RCPT TO:<${sanitizeHeader(recipient)}>`, [250, 251]);
    }

    await writeSmtp(socket, 'DATA', 354);
    socket.write(`${buildMimeMessage({ from, to: recipients, subject, text })}\r\n.\r\n`);
    await expectSmtp(socket, 250, 'DATA body');
    socket.write('QUIT\r\n');
  } finally {
    socket.end();
  }
}

async function sendBetaFeedbackEmail(feedback, { envConfig = env, smtpSender = sendSmtpMail } = {}) {
  const to = getFeedbackEmailRecipients(envConfig);
  const configStatus = getSmtpConfigStatus(envConfig);

  if (!configStatus.configured) {
    return {
      status: 'skipped',
      error: `missing ${configStatus.missing.join(', ')}`,
      to,
      configured: false,
    };
  }

  try {
    await smtpSender({
      envConfig,
      to,
      subject: 'Neues kaufklug Beta-Feedback',
      text: buildBetaFeedbackEmailText(feedback),
    });

    return {
      status: 'sent',
      error: null,
      to,
      configured: true,
    };
  } catch (error) {
    return {
      status: 'failed',
      error: shortError(error),
      to,
      configured: true,
    };
  }
}

module.exports = {
  DEFAULT_FEEDBACK_EMAIL_TO,
  DEFAULT_FEEDBACK_EMAIL_TIMEOUT_MS,
  buildBetaFeedbackEmailText,
  getFeedbackEmailRecipient,
  getFeedbackEmailRecipients,
  getFeedbackEmailTimeoutMs,
  getSmtpConfigStatus,
  hasSmtpConfig,
  sendBetaFeedbackEmail,
  sendSmtpMail,
};
