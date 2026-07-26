# syntax=docker/dockerfile:1.7
# Multi-stage build for the CrewLog Fastify backend.

# ---------- 1. Install full deps (incl. dev) for the build ----------
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---------- 2. Compile TypeScript ----------
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------- 3. Runtime image (production deps only) ----------
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4000
WORKDIR /app

# Install only production deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
 && npm cache clean --force

# Copy compiled output (dist/), and the original knexfile/migrations/seeds
# knexfile.ts points at ./migrations and ./seeds; tsconfig includes them,
# so they end up under dist/. Knexfile is patched to pick .js in production.
COPY --from=build /app/dist ./dist

# Persistent upload directory (mount a Coolify volume at /app/uploads)
RUN mkdir -p /app/uploads && chown -R node:node /app
USER node

EXPOSE 4000

# Lightweight healthcheck — the /health route also pings the DB.
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/health >/dev/null 2>&1 || exit 1

CMD ["node", "dist/src/server.js"]