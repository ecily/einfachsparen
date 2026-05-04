const crypto = require('node:crypto');
const env = require('../config/env');
const logger = require('../lib/logger');

let missingKeyWarningLogged = false;

function safeEquals(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function requireAdminApiKey(req, res, next) {
  if (!env.ADMIN_API_KEY) {
    if (!missingKeyWarningLogged) {
      missingKeyWarningLogged = true;
      logger.warn('Interne Route ohne konfigurierten ADMIN_API_KEY angefragt', {
        environment: env.NODE_ENV,
      });
    }

    return res.status(503).json({
      ok: false,
      message: 'Interner Zugriff ist nicht konfiguriert.',
    });
  }

  const providedKey = req.get('x-admin-api-key') || '';

  if (!safeEquals(providedKey, env.ADMIN_API_KEY)) {
    return res.status(401).json({
      ok: false,
      message: 'Admin-Zugriff erforderlich.',
    });
  }

  return next();
}

module.exports = {
  requireAdminApiKey,
};
