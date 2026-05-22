const express = require('express');
const env = require('../config/env');
const { getDatabaseState } = require('../config/mongodb');
const { buildSafeBuildInfo } = require('../services/buildInfo');
const filterMetadataService = require('../services/filters/filterMetadataService');

const FILTER_METADATA_COLLECTIONS = [
  'retailers',
  'categories',
  'retailercategorystats',
  'retailercategoryoffercaches',
];

function buildFilterRebuildContext({ envConfig = env, dbState = getDatabaseState(), buildInfo = buildSafeBuildInfo() } = {}) {
  const isProduction = envConfig.NODE_ENV === 'production';

  return {
    nodeEnv: envConfig.NODE_ENV,
    database: {
      connected: dbState.readyState === 1,
      name: dbState.name || envConfig.MONGODB_DB_NAME || '',
    },
    build: buildInfo,
    operation: {
      name: 'filter-metadata-rebuild',
      allowedInCurrentEnvironment: isProduction,
      mutatesCollections: FILTER_METADATA_COLLECTIONS,
      doesNotRun: ['crawl', 'reindex', 'repair-apply', 'hard-delete'],
    },
  };
}

function assertProductionFilterRebuildAllowed(context) {
  if (context.nodeEnv !== 'production') {
    const error = new Error('Filtermetadata-Rebuild ist nur in NODE_ENV=production erlaubt.');
    error.statusCode = 409;
    error.details = {
      nodeEnv: context.nodeEnv,
      databaseName: context.database.name,
    };
    throw error;
  }

  if (!context.database.connected) {
    const error = new Error('Datenbankverbindung ist nicht bereit.');
    error.statusCode = 503;
    error.details = {
      nodeEnv: context.nodeEnv,
      databaseName: context.database.name,
    };
    throw error;
  }
}

function createAdminRouter({
  envConfig = env,
  filterMetadataServiceImpl = filterMetadataService,
  dbStateProvider = getDatabaseState,
  buildInfoProvider = buildSafeBuildInfo,
} = {}) {
  const router = express.Router();

  router.get('/filters/rebuild-context', (req, res) => {
    res.json({
      ok: true,
      context: buildFilterRebuildContext({
        envConfig,
        dbState: dbStateProvider(),
        buildInfo: buildInfoProvider(),
      }),
    });
  });

  router.post('/filters/rebuild', async (req, res, next) => {
    const startedAt = Date.now();

    try {
      const context = buildFilterRebuildContext({
        envConfig,
        dbState: dbStateProvider(),
        buildInfo: buildInfoProvider(),
      });

      assertProductionFilterRebuildAllowed(context);

      const summary = await filterMetadataServiceImpl.rebuildFilterMetadata({
        trigger: 'admin-api',
        loggerContext: { invokedBy: 'POST /api/admin/filters/rebuild' },
      });

      res.json({
        ok: true,
        durationMs: Date.now() - startedAt,
        context,
        summary,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

const router = createAdminRouter();

module.exports = router;
module.exports.createAdminRouter = createAdminRouter;
module.exports.buildFilterRebuildContext = buildFilterRebuildContext;
module.exports.FILTER_METADATA_COLLECTIONS = FILTER_METADATA_COLLECTIONS;
