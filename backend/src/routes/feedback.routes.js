const express = require('express');
const env = require('../config/env');
const logger = require('../lib/logger');
const { requireAdminApiKey } = require('../middleware/adminAuth');
const { feedbackRateLimit } = require('../middleware/rateLimits');
const { validateFeedbackPayload } = require('../middleware/validators');
const AdminFeedback = require('../models/AdminFeedback');
const BetaFeedback = require('../models/BetaFeedback');
const {
  FEATURE_INTERESTS,
  FEEDBACK_TYPES,
} = require('../models/BetaFeedback');
const { sendBetaFeedbackEmail } = require('../services/feedbackEmailService');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HONEYPOT_FIELDS = ['website', 'company', 'homepage', 'fax', 'hp', 'honeypot'];

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function rejectBadRequest(message) {
  throw createHttpError(400, message);
}

function trimString(value, { field, maxLength, minLength = 0, required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) rejectBadRequest(`${field} ist erforderlich.`);
    return '';
  }

  if (typeof value !== 'string') {
    rejectBadRequest(`${field} muss ein Text sein.`);
  }

  const trimmed = value.trim();

  if (required && !trimmed) {
    rejectBadRequest(`${field} ist erforderlich.`);
  }

  if (trimmed && trimmed.length < minLength) {
    rejectBadRequest(`${field} ist zu kurz.`);
  }

  if (trimmed.length > maxLength) {
    rejectBadRequest(`${field} ist zu lang.`);
  }

  return trimmed;
}

function normalizeEnum(value, { field, allowedValues, fallback }) {
  const text = trimString(value || fallback, { field, maxLength: 80 }) || fallback;

  if (!allowedValues.includes(text)) {
    rejectBadRequest(`${field} ist ungueltig.`);
  }

  return text;
}

function normalizeStringArray(value, { field, allowedValues, maxItems = 20 } = {}) {
  if (value === undefined || value === null || value === '') return [];

  if (!Array.isArray(value)) {
    rejectBadRequest(`${field} muss eine Liste sein.`);
  }

  if (value.length > maxItems) {
    rejectBadRequest(`${field} enthaelt zu viele Werte.`);
  }

  const items = [];

  for (const rawItem of value) {
    const item = trimString(rawItem, { field, maxLength: 80 });
    if (!item) continue;

    if (!allowedValues.includes(item)) {
      rejectBadRequest(`${field} enthaelt einen ungueltigen Wert.`);
    }

    if (!items.includes(item)) {
      items.push(item);
    }
  }

  return items;
}

function hasHoneypotContent(body = {}) {
  return HONEYPOT_FIELDS.some((field) => String(body[field] || '').trim().length > 0);
}

function looksLikeBetaFeedbackPayload(body = {}) {
  return body.message !== undefined
    || body.feedbackType !== undefined
    || body.featureInterests !== undefined
    || body.requestedMarkets !== undefined
    || body.name !== undefined
    || body.email !== undefined
    || hasHoneypotContent(body);
}

function normalizeBetaFeedbackPayload(body = {}) {
  const name = trimString(body.name, { field: 'name', maxLength: 120 }) || null;
  const email = trimString(body.email, { field: 'email', maxLength: 254 }) || null;

  if (email && !EMAIL_PATTERN.test(email)) {
    rejectBadRequest('email ist ungueltig.');
  }

  return {
    name,
    email,
    message: trimString(body.message, {
      field: 'message',
      minLength: 20,
      maxLength: 3000,
      required: true,
    }),
    feedbackType: normalizeEnum(body.feedbackType, {
      field: 'feedbackType',
      allowedValues: FEEDBACK_TYPES,
      fallback: 'other',
    }),
    requestedMarkets: trimString(body.requestedMarkets, {
      field: 'requestedMarkets',
      maxLength: 500,
    }) || null,
    featureInterests: normalizeStringArray(body.featureInterests, {
      field: 'featureInterests',
      allowedValues: FEATURE_INTERESTS,
      maxItems: FEATURE_INTERESTS.length,
    }),
    sourcePage: '/feedback',
  };
}

function validateLegacyAdminFeedback(req) {
  let validationError = null;
  validateFeedbackPayload(req, {}, (error) => {
    validationError = error || null;
  });

  if (validationError) {
    throw validationError;
  }
}

async function createLegacyAdminFeedback(req, res, AdminFeedbackModel = AdminFeedback) {
  validateLegacyAdminFeedback(req);

  const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
  const digest = typeof req.body?.digest === 'string' ? req.body.digest.trim() : '';
  const scope = typeof req.body?.scope === 'string' ? req.body.scope : 'crawl-review';

  if (!note) {
    return res.status(400).json({
      ok: false,
      message: 'Feedback note is required.',
    });
  }

  const item = await AdminFeedbackModel.create({
    region: env.CRAWL_REGION,
    scope,
    note,
    digest,
    metadata: req.body?.metadata && typeof req.body.metadata === 'object'
      ? { ...req.body.metadata, source: 'public-feedback' }
      : { source: 'public-feedback' },
  });

  return res.status(201).json({
    ok: true,
    item,
  });
}

async function updateEmailDeliveryStatus(BetaFeedbackModel, feedback, delivery) {
  const feedbackId = feedback?._id || feedback?.id;
  const update = {
    emailDeliveryStatus: delivery.status,
    emailDeliveryError: delivery.error || null,
  };

  if (feedbackId && typeof BetaFeedbackModel.findByIdAndUpdate === 'function') {
    await BetaFeedbackModel.findByIdAndUpdate(feedbackId, update);
    return;
  }

  Object.assign(feedback, update);
}

async function sendFeedbackEmailSafely(emailSender, feedback) {
  try {
    const delivery = await emailSender(feedback);

    return delivery && typeof delivery === 'object'
      ? delivery
      : { status: 'failed', error: 'email sender returned invalid result' };
  } catch (error) {
    return {
      status: 'failed',
      error: String(error?.message || error || 'email delivery failed').replace(/\s+/g, ' ').slice(0, 240),
    };
  }
}

function createFeedbackRouter({
  AdminFeedbackModel = AdminFeedback,
  BetaFeedbackModel = BetaFeedback,
  rateLimitMiddleware = feedbackRateLimit,
  emailSender = sendBetaFeedbackEmail,
} = {}) {
  const router = express.Router();

  router.get('/', requireAdminApiKey, async (req, res, next) => {
    try {
      const items = await AdminFeedbackModel.find().sort({ createdAt: -1 }).limit(20).lean();
      res.json({ items });
    } catch (error) {
      next(error);
    }
  });

  router.post('/', rateLimitMiddleware, async (req, res, next) => {
    try {
      if (!looksLikeBetaFeedbackPayload(req.body || {})) {
        return createLegacyAdminFeedback(req, res, AdminFeedbackModel);
      }

      if (hasHoneypotContent(req.body || {})) {
        return res.status(200).json({
          ok: true,
          message: 'Danke. Dein Feedback wurde gesendet.',
          blocked: true,
        });
      }

      const payload = normalizeBetaFeedbackPayload(req.body || {});
      const feedback = await BetaFeedbackModel.create({
        ...payload,
        emailDeliveryStatus: 'pending',
        emailDeliveryError: null,
      });
      const delivery = await sendFeedbackEmailSafely(emailSender, feedback);

      try {
        await updateEmailDeliveryStatus(BetaFeedbackModel, feedback, delivery);
      } catch (updateError) {
        logger.warn('Beta feedback email status update failed', {
          feedbackId: String(feedback?._id || feedback?.id || ''),
          message: updateError.message,
        });
      }

      const emailLogPayload = {
        feedbackId: String(feedback?._id || feedback?.id || ''),
        emailDeliveryStatus: delivery.status,
        recipient: delivery.to || '',
      };

      if (delivery.status === 'sent') {
        logger.info('Beta feedback email sent', emailLogPayload);
      } else if (delivery.status === 'not_configured') {
        logger.warn('Beta feedback email not configured', {
          ...emailLogPayload,
          error: delivery.error || 'SMTP config missing',
        });
      } else {
        logger.error('Beta feedback email failed', {
          ...emailLogPayload,
          error: delivery.error || 'email delivery failed',
        });
      }

      if (delivery.status !== 'sent') {
        logger.info('Beta feedback stored without email delivery', {
          feedbackId: String(feedback?._id || feedback?.id || ''),
          emailDeliveryStatus: delivery.status,
        });
      }

      return res.status(201).json({
        ok: true,
        feedbackId: String(feedback._id || feedback.id || ''),
        emailDeliveryStatus: delivery.status,
        emailDeliveryConfigured: delivery.status !== 'not_configured',
        emailDeliveryDiagnostic: delivery.status === 'sent' ? null : (delivery.error || delivery.status),
        message: 'Danke. Dein Feedback wurde gesendet und hilft uns, kaufklug gezielt zu verbessern.',
      });
    } catch (error) {
      if (error.statusCode === 400) {
        return res.status(400).json({
          ok: false,
          message: error.message,
        });
      }

      return next(error);
    }
  });

  return router;
}

module.exports = createFeedbackRouter();
module.exports.createFeedbackRouter = createFeedbackRouter;
module.exports.normalizeBetaFeedbackPayload = normalizeBetaFeedbackPayload;
module.exports.hasHoneypotContent = hasHoneypotContent;
