# syntax=docker/dockerfile:1.7
# Multi-stage build for the CrewLog Vite/React SPA.
# Build args let the production image bake the API URL into the bundle.

# ---------- 1. Build the SPA ----------
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .

# VITE_API_URL is the *origin* the SPA calls the API at — NOT a path prefix.
# Leave it empty so URLs stay first-party-relative (`/api/v1/...`) and the
# nginx `/api/` location proxies them to the backend. In dev, set it to
# `http://localhost:4000` (see frontend/.env.example) so the SPA can call the
# backend directly while Vite serves the bundle. NEVER set this to `/api` —
# the call sites already include the `/api/v1/...` path, so a `/api` prefix
# would double up to `/api/api/v1/...` and miss the backend.
ARG VITE_API_URL=
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build

# ---------- 2. Serve via nginx ----------
FROM nginx:1.27-alpine AS runtime

# Drop our SPA + /api reverse-proxy config into the official nginx image's
# templates directory. The image's entrypoint runs envsubst on
# /etc/nginx/templates/*.template at startup, expanding ${BACKEND_UPSTREAM}
# into the rendered /etc/nginx/conf.d/default.conf before nginx is launched.
COPY nginx.conf /etc/nginx/templates/default.conf.template

# Static assets from the Vite build (output dir is dist/ by default)
COPY --from=build /app/dist /usr/share/nginx/html

# Run as the unprivileged nginx user.
# nginx:alpine already ships with `nginx` user; ensure permissions are sane.
RUN chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /var/log/nginx

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]