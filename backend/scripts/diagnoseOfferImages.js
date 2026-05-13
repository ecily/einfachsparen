const axios = require('axios');
const mongoose = require('mongoose');

process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';

const { connectToDatabase } = require('../src/config/mongodb');
const Offer = require('../src/models/Offer');
const { isUsableImageUrl } = require('../src/services/images/imageUrl');

const TARGET_RETAILERS = [
  'billa',
  'billa-plus',
  'bipa',
  'dm',
  'hofer',
  'lidl',
  'pagro',
  'penny',
  'spar',
  'adeg',
];

function parseArgs(argv = []) {
  const options = {
    limit: 20,
    proxyBaseUrl: '',
  };

  for (const arg of argv) {
    if (arg.startsWith('--limit=')) {
      const value = Number(arg.slice('--limit='.length));
      if (Number.isInteger(value) && value >= 1 && value <= 100) {
        options.limit = value;
      }
    }

    if (arg.startsWith('--proxy-base-url=')) {
      options.proxyBaseUrl = arg.slice('--proxy-base-url='.length).replace(/\/+$/, '');
    }
  }

  return options;
}

async function checkProxyImage(proxyBaseUrl, offerId) {
  if (!proxyBaseUrl || !offerId) {
    return { checked: false, ok: false, status: null, contentType: '', error: '' };
  }

  try {
    const response = await axios.get(`${proxyBaseUrl}/api/offers/${offerId}/image`, {
      responseType: 'arraybuffer',
      timeout: 10000,
      maxRedirects: 0,
      validateStatus: () => true,
    });
    const contentType = String(response.headers['content-type'] || '');

    return {
      checked: true,
      ok: response.status >= 200 && response.status < 300 && contentType.toLowerCase().startsWith('image/'),
      status: response.status,
      contentType,
      error: '',
    };
  } catch (error) {
    return {
      checked: true,
      ok: false,
      status: error.response?.status || null,
      contentType: String(error.response?.headers?.['content-type'] || ''),
      error: error.message,
    };
  }
}

async function summarizeRetailer(retailerKey, options) {
  const now = new Date();
  const offers = await Offer.find({
    retailerKey,
    $or: [
      { isActiveNow: true },
      { isActiveToday: true },
      {
        status: 'active',
        $or: [
          { validTo: { $gte: now } },
          { validTo: null },
        ],
      },
    ],
  })
    .sort({ isActiveNow: -1, sortScoreDefault: -1, lastSeenAt: -1 })
    .limit(options.limit)
    .select('_id title imageUrl retailerKey sourceType')
    .lean();

  let imagePresent = 0;
  let usableImageUrl = 0;
  let proxySuccess = 0;
  const samplesWithoutImage = [];
  const proxyFailures = [];

  for (const offer of offers) {
    if (offer.imageUrl) {
      imagePresent += 1;
    } else if (samplesWithoutImage.length < 3) {
      samplesWithoutImage.push({ id: String(offer._id), title: offer.title, sourceType: offer.sourceType });
    }

    if (isUsableImageUrl(offer.imageUrl)) {
      usableImageUrl += 1;
    }

    if (offer.imageUrl && options.proxyBaseUrl) {
      const proxyResult = await checkProxyImage(options.proxyBaseUrl, String(offer._id));
      if (proxyResult.ok) {
        proxySuccess += 1;
      } else if (proxyFailures.length < 3) {
        proxyFailures.push({
          id: String(offer._id),
          title: offer.title,
          status: proxyResult.status,
          contentType: proxyResult.contentType,
          error: proxyResult.error,
        });
      }
    }
  }

  return {
    retailerKey,
    sampled: offers.length,
    imagePresent,
    imageMissing: Math.max(0, offers.length - imagePresent),
    usableImageUrl,
    proxyChecked: Boolean(options.proxyBaseUrl),
    proxySuccess,
    samplesWithoutImage,
    proxyFailures,
  };
}

async function run() {
  const options = parseArgs(process.argv.slice(2));

  await connectToDatabase();

  const retailers = [];
  for (const retailerKey of TARGET_RETAILERS) {
    retailers.push(await summarizeRetailer(retailerKey, options));
  }

  console.log(JSON.stringify({
    ok: true,
    readOnly: true,
    mutatedCollections: [],
    generatedAt: new Date().toISOString(),
    limitPerRetailer: options.limit,
    proxyChecked: Boolean(options.proxyBaseUrl),
    retailers,
  }, null, 2));
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error(JSON.stringify({
        ok: false,
        readOnly: true,
        mutatedCollections: [],
        message: error.message,
      }, null, 2));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect().catch(() => {});
    });
}
