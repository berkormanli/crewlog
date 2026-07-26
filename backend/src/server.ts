import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyJwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import { db } from './db/index.js';
import { registerJwt } from './lib/jwt.js';
import { authRoutes } from './modules/auth/routes.js';
import { userRoutes } from './modules/users/routes.js';
import { projectRoutes } from './modules/projects/routes.js';
import { taskRoutes } from './modules/tasks/routes.js';
import { documentRoutes, folderRoutes } from './modules/documents/routes.js';
import { workLogRoutes } from './modules/work-logs/routes.js';
import { capacityRoutes } from './modules/capacity/routes.js';
import { lookupRoutes } from './modules/lookups/routes.js';
import { integrationRoutes } from './modules/meetings/routes.js';
import { dashboardRoutes } from './modules/dashboard/routes.js';
import { customerRoutes } from './modules/customers/routes.js';
import { taskRequestRoutes } from './modules/task-requests/routes.js';
import { taskSessionRoutes } from './modules/task-sessions/routes.js';
import { auditRoutes } from './modules/audit/routes.js';
import { HttpError } from './lib/errors.js';

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      transport:
        config.env === 'development'
          ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
          : undefined,
    },
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // curl, server-to-server
      if (config.corsOrigins.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
  });

  await app.register(multipart, {
    limits: { fileSize: config.uploads.maxBytes },
  });

  await app.register(rateLimit, {
    global: false, // only on login
  });

  // JWT
  await registerJwt(app);

  // Public-route enforcement + access-token-kind check + user-still-exists check.
  app.addHook('onRequest', async (req) => {
    const url = req.routeOptions?.url ?? req.url;
    const publicPaths = [
      '/health',
      '/api/v1/auth/login',
      '/api/v1/auth/refresh',
      // Inbound webhooks authenticate via HMAC signature, not JWT.
      '/api/v1/integrations/fireflies/webhook',
    ];
    const isPublic =
      publicPaths.some((p) => url === p || url.startsWith(p + '/')) ||
      !url.startsWith('/api/v1');
    if (isPublic) return;
    try {
      await (req as any).jwtVerify();
    } catch {
      const { unauthorized } = await import('./lib/errors.js');
      throw unauthorized('Missing or invalid access token');
    }
    // Disallow refresh tokens from being used on the access API
    if (req.user?.kind && req.user.kind !== 'access') {
      const { unauthorized } = await import('./lib/errors.js');
      throw unauthorized('Access token required');
    }

    // The JWT signature is valid, but the user the token refers to may have
    // been removed (e.g. wiped during a re-seed, deactivated, or moved to
    // another tenant). Without this check, downstream routes that insert
    // `created_by` / `uploaded_by` / `requested_by` would crash with a 500
    // from a foreign-key violation. Reject early with 401 instead so the
    // client can clear its session and re-authenticate.
    if (req.user?.sub && req.user?.tid) {
      const row = await db('users')
        .where({ id: req.user.sub, tenant_id: req.user.tid })
        .select('id')
        .first();
      if (!row) {
        const { unauthorized } = await import('./lib/errors.js');
        throw unauthorized('Session refers to a user that no longer exists. Please sign in again.');
      }
    }
  });

  // Health
  app.get('/health', async () => {
    try {
      await db.raw('SELECT 1');
      return { status: 'ok', db: 'ok' };
    } catch (e: any) {
      return { status: 'degraded', db: 'fail', message: e.message };
    }
  });

  // API v1
  await app.register(async (api) => {
    await api.register(authRoutes);
    await api.register(userRoutes);
    await api.register(customerRoutes);
    await api.register(projectRoutes);
    await api.register(taskRoutes);
    await api.register(taskRequestRoutes);
    await api.register(taskSessionRoutes);
    await api.register(folderRoutes);
    await api.register(documentRoutes);
    await api.register(workLogRoutes);
    await api.register(capacityRoutes);
    await api.register(lookupRoutes);
    await api.register(integrationRoutes);
    await api.register(dashboardRoutes);
    await api.register(auditRoutes);
  }, { prefix: '/api/v1' });

  // Error handler — shapes HttpError into the spec'd JSON envelope.
  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof HttpError) {
      reply.status(err.status).send(err.toJSON());
      return;
    }
    // Validation from fastify schema (e.g. multipart limits)
    if (err.statusCode && err.statusCode < 500) {
      reply.status(err.statusCode).send({
        error: { code: err.code ?? 'bad_request', message: err.message },
      });
      return;
    }
    req.log.error({ err }, 'unhandled');
    reply.status(500).send({
      error: { code: 'internal_error', message: 'Internal server error' },
    });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({
      error: { code: 'not_found', message: `Route ${req.method} ${req.url} not found` },
    });
  });

  // Silence jwt unused
  void fastifyJwt;

  return app;
}

async function main() {
  const app = await buildServer();
  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main();
}
