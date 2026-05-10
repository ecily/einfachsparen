const path = require('node:path');
const dotenv = require('dotenv');
const { z } = require('zod');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();

    if (normalized === 'true') {
      return true;
    }

    if (normalized === 'false') {
      return false;
    }
  }

  return value;
}, z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  MONGODB_DB_NAME: z.string().min(1, 'MONGODB_DB_NAME is required'),
  ADMIN_ORIGIN: z.string().url().default('http://localhost:5174'),
  ADMIN_API_KEY: z.string().trim().default(''),
  KAUFKLUG_PUBLIC_ORIGIN: z.string().url().default('https://www.kaufklug.at'),
  KAUFKLUG_APK_URL: z.string().url().default('https://stepsmatch.fra1.digitaloceanspaces.com/kaufklug/kaufklug_alpha.apk'),
  ANALYTICS_SESSION_SECRET: z.string().min(16).default('change-this-analytics-session-secret'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  CRAWL_REGION: z.string().default('Grossraum Graz'),
  CRAWL_RUN_ON_START: booleanFromEnv.default(false),
  CRAWL_SCHEDULE_ENABLED: booleanFromEnv.default(false),
  CRAWL_SCHEDULE_CRON: z.string().trim().default('0 2 * * *'),
  CRAWL_SCHEDULE_TIMEZONE: z.string().trim().default('Europe/Vienna'),
  CRAWL_INTERVAL_MINUTES: z.coerce.number().int().min(15).max(1440).default(360),
}).superRefine((value, context) => {
  if (value.NODE_ENV === 'production' && !value.ADMIN_API_KEY) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['ADMIN_API_KEY'],
      message: 'ADMIN_API_KEY is required in production',
    });
  }
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('\n');

  throw new Error(`Invalid environment configuration:\n${issues}`);
}

module.exports = parsed.data;
