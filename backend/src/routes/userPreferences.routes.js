const express = require('express');
const UserPreference = require('../models/UserPreference');

const router = express.Router();
const DEFAULT_PROFILE_KEY = 'local-default-user';

async function getOrCreatePreferences() {
  let preferences = await UserPreference.findOne({ profileKey: DEFAULT_PROFILE_KEY }).lean();

  if (!preferences) {
    const created = await UserPreference.create({
      profileKey: DEFAULT_PROFILE_KEY,
      retailerPrograms: {},
    });

    preferences = created.toObject();
  }

  return preferences;
}

router.get('/current', async (req, res, next) => {
  try {
    const preferences = await getOrCreatePreferences();

    res.json({
      ok: true,
      profileKey: preferences.profileKey,
      retailerPrograms: preferences.retailerPrograms || {},
      updatedAt: preferences.updatedAt,
    });
  } catch (error) {
    next(error);
  }
});

router.put('/current', async (req, res, next) => {
  try {
    const incomingPrograms =
      req.body && typeof req.body.retailerPrograms === 'object' && !Array.isArray(req.body.retailerPrograms)
        ? req.body.retailerPrograms
        : {};

    const sanitizedPrograms = Object.fromEntries(
      Object.entries(incomingPrograms).map(([retailerKey, hasProgram]) => [String(retailerKey), Boolean(hasProgram)])
    );

    const preferences = await UserPreference.findOneAndUpdate(
      { profileKey: DEFAULT_PROFILE_KEY },
      {
        $set: {
          retailerPrograms: sanitizedPrograms,
        },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      }
    ).lean();

    res.json({
      ok: true,
      profileKey: preferences.profileKey,
      retailerPrograms: preferences.retailerPrograms || {},
      updatedAt: preferences.updatedAt,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
