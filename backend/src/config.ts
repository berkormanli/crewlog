import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  host: process.env.HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 4000),
  logLevel: process.env.LOG_LEVEL ?? 'info',

  databaseUrl: required('DATABASE_URL'),

  jwt: {
    accessSecret: required('JWT_ACCESS_SECRET', 'dev-access-secret-change-me'),
    refreshSecret: required('JWT_REFRESH_SECRET', 'dev-refresh-secret-change-me'),
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL ?? '7d',
  },

  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  uploads: {
    dir: process.env.UPLOAD_DIR ?? './uploads',
    maxBytes: Number(process.env.UPLOAD_MAX_BYTES ?? 26_214_400),
  },

  rateLimit: {
    authMax: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 10),
    authWindow: process.env.AUTH_RATE_LIMIT_WINDOW ?? '1 minute',
  },

  /**
   * How many days in the past a worker is allowed to log time. The colleague
   * call (paraphrased): "default the activity date to today; allow 2–3 days
   * of backdating so people can catch up after a missed day or weekend".
   * We default to 2 for the strictest behavior; raise via env if needed.
   */
  backdateWindowDays: Number(process.env.BACKDATE_WINDOW_DAYS ?? 2),

  /**
   * Integration toggles. Today: just fireflies. Both default OFF so existing
   * deployments stay inert until the env is set.
   */
  integrations: {
    firefliesEnabled: (process.env.FIREFLIES_ENABLED ?? 'false') === 'true',
    firefliesWebhookSecret: process.env.FIREFLIES_WEBHOOK_SECRET ?? '',
    /**
     * LLM provider for action proposal generation. With provider=none we fall
     * back to a deterministic keyword-based stub (useful for demos/tests).
     */
    llmProvider: (process.env.LLM_PROVIDER ?? 'stub') as 'stub' | 'openai' | 'anthropic',
    llmApiKey: process.env.LLM_API_KEY ?? '',
  },
};
