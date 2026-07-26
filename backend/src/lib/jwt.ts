import type { FastifyInstance, FastifyRequest } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { config } from '../config.js';
import { unauthorized } from './errors.js';

export type Role = 'worker' | 'manager' | 'admin';

export interface AuthPayload {
  sub: string;
  tid: string;
  role: Role;
  email: string;
  name: string;
  kind?: 'access' | 'refresh';
  jti?: string;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthPayload;
    user: AuthPayload;
  }
}

/**
 * Both access and refresh are issued via a single @fastify/jwt instance. The
 * `kind` discriminator in the payload tells the verifier which one it is.
 * The default decorator `app.jwt.sign(...)` and `req.jwtVerify(...)` are used.
 */
export async function registerJwt(app: FastifyInstance) {
  await app.register(fastifyJwt, {
    secret: config.jwt.accessSecret,
  });
}

export async function signAccessToken(app: FastifyInstance, payload: AuthPayload) {
  return app.jwt.sign({ ...payload, kind: 'access' }, { expiresIn: config.jwt.accessTtl, jti: payload.jti } as any);
}
export async function signRefreshToken(app: FastifyInstance, payload: AuthPayload) {
  return app.jwt.sign({ ...payload, kind: 'refresh' }, { expiresIn: config.jwt.refreshTtl, jti: payload.jti } as any);
}
export async function verifyToken(app: FastifyInstance, token: string): Promise<AuthPayload> {
  return app.jwt.verify(token);
}

export function requireRole(...allowed: Role[]) {
  return async (req: FastifyRequest) => {
    const u = req.user;
    if (!u) throw unauthorized();
    if (!allowed.includes(u.role)) {
      const { forbidden } = await import('./errors.js');
      throw forbidden(`Requires role: ${allowed.join(' | ')}`);
    }
  };
}

export function canManage(role: Role) {
  return role === 'manager' || role === 'admin';
}

export function canAdmin(role: Role) {
  return role === 'admin';
}
