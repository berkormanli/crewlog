# Deploying CrewLog on Coolify

Coolify is a self-hosted PaaS that builds and runs Docker containers on your
own server. CrewLog ships with everything you need to deploy it two ways:

| Path | What it is | Best when |
|------|------------|-----------|
| **A — Single Docker Compose resource** | One Coolify resource consuming `docker-compose.production.yml` (postgres + backend + frontend) | Small team, single server, want one-click deploy |
| **B — Three Coolify resources** | Separate Postgres *Database*, backend *Application*, and frontend *Application* | Production, want built-in DB backups, easy scale-out |

Both paths share the same images, environment variables, and git workflow.

---

## 0. Prereqs on the Coolify host

- A Linux server running Coolify ≥ 4.0.00
- Outbound HTTPS to your git provider (GitHub / GitLab / Gitea)
- DNS A (or CNAME) records pointing at the server for `crewlog.yourdomain`
- ~1 GB free RAM (the Postgres + backend + frontend stack is light)

---

## 1. Push the repo

Coolify builds straight from a git remote, so the repo has to be cloned there.

```bash
git init                                  # if you haven't already
git add .
git commit -m "feat: prepare for Coolify deploy"
git remote add origin git@github.com:YOU/crewlog.git
git push -u origin main
```

Then in the Coolify UI: **Settings → Sources → Add** and authorize the git
provider that owns the repo (GitHub / GitLab / Gitea / Custom Git).

---

## 2. Generate secrets

Once. Paste the outputs into Coolify later.

```bash
# Two JWT secrets — keep them distinct.
openssl rand -base64 48   # → JWT_ACCESS_SECRET
openssl rand -base64 48   # → JWT_REFRESH_SECRET

# Postgres password.
openssl rand -base64 32   # → POSTGRES_PASSWORD

# Optional, only if you turn FIREFLIES_ENABLED=true:
openssl rand -hex 32      # → FIREFLIES_WEBHOOK_SECRET
```

`.env.production.example` documents every variable Coolify needs.

---

## Path A — Single Docker Compose resource (simplest)

1. In Coolify: **+ New → Resource → Docker Compose**.
2. **Source**: pick the git remote + branch (e.g. `main`).
3. **Docker Compose Location**: `docker-compose.production.yml`.
4. **Environment Variables**: copy each key from
   `.env.production.example` into the UI and paste your generated secrets.
   The compose file uses `${VAR:?}` syntax, so Coolify will refuse to start
   the stack if a required secret is missing — this is intentional.
5. **Persistent Storage** — Coolify will pick up the two named volumes
   (`crewlog_pgdata`, `crewlog_uploads`) automatically. Make sure both are
   listed under *Volumes* so they survive redeploys.
6. **Domains**: assign a hostname (e.g. `crewlog.yourdomain`) to the
   `frontend` service. Coolify will request a Let's Encrypt certificate for
   it. *Do not* expose the backend — only the frontend should be public.
7. Click **Deploy**. Watch the build log. The first build compiles the
   Vite SPA and the Fastify backend, then boots all three containers.

> ⚠️ **Port 80 collision.** Coolify's Traefik reverse proxy already binds
> 80/443 on the host, so the compose file publishes the frontend on
> `8080:80` by default. When you set a Domain in the Coolify UI, it
> routes your hostname to that published port automatically. If 8080 is
> also taken on your host, set `FRONTEND_PORT=<other-port>` in the env
> vars and redeploy.

### First-time database setup

The compose stack does **not** run migrations automatically. After the first
successful deploy:

```bash
# From your dev machine, pointed at the running backend
DATABASE_URL=postgres://crewlog:$POSTGRES_PASSWORD@<server>:5432/crewlog \
  npm --prefix backend run migrate
```

Or open a one-off shell against the `backend` container via Coolify's
**Execute** button and run:

```bash
node node_modules/knex/bin/cli.js --knexfile knexfile.js migrate:latest
```

(Optional) seed demo data:

```bash
node node_modules/knex/bin/cli.js --knexfile knexfile.js seed:run
```

If you'd rather have migrations run on every deploy, add a **Post-Deployment
Command** in the Coolify UI:

```
node node_modules/knex/bin/cli.js --knexfile knexfile.js migrate:latest
```

…with `Working Directory = /app`. (Seeds are intentionally not run here —
seed wipes & re-inserts demo data and should be a manual step.)

---

## Path B — Three Coolify resources (production-grade)

### B1. Postgres database

1. **+ New → Resource → Database → PostgreSQL 16**.
2. Name: `crewlog-db`.
3. Set `POSTGRES_USER=crewlog`, `POSTGRES_DB=crewlog`, and a strong
   `POSTGRES_PASSWORD`. Coolify will manage backups and expose the
   connection string via the *Internal* DNS host `crewlog-db` on port 5432.

### B2. Backend application

1. **+ New → Resource → Application**.
2. **Build Pack**: `Dockerfile`.
3. **Dockerfile Location**: `backend/Dockerfile`.
4. **Port**: `4000`. **Do not** expose publicly — only the frontend needs
   to reach it.
5. **Environment Variables** (paste the values from section 2):

   | Key | Value / example |
   |-----|-----------------|
   | `NODE_ENV` | `production` |
   | `HOST` | `0.0.0.0` |
   | `PORT` | `4000` |
   | `DATABASE_URL` | `postgres://crewlog:THE_PASSWORD@crewlog-db:5432/crewlog` |
   | `JWT_ACCESS_SECRET` | *generated above* |
   | `JWT_REFRESH_SECRET` | *generated above* |
   | `JWT_ACCESS_TTL` | `15m` |
   | `JWT_REFRESH_TTL` | `7d` |
   | `CORS_ORIGINS` | `https://crewlog.yourdomain` — comma-separate for multiple SPA origins. Defaults to `https://crewlog.pulsarsoftwares.com` in compose; override here if you use a different host. |
   | `UPLOAD_DIR` | `/app/uploads` |
   | `UPLOAD_MAX_BYTES` | `26214400` |
   | `AUTH_RATE_LIMIT_MAX` | `10` |
   | `AUTH_RATE_LIMIT_WINDOW` | `1 minute` |
   | `BACKDATE_WINDOW_DAYS` | `2` |
   | `FIREFLIES_ENABLED` | `false` |
   | `LLM_PROVIDER` | `stub` |

6. **Persistent Storage**: add a volume mount at `/app/uploads`.
7. **Post-Deployment Command** (so every deploy runs migrations):

   ```
   node node_modules/knex/bin/cli.js --knexfile knexfile.js migrate:latest
   ```

   *Working Directory* = `/app`. Coolify exposes this in the UI under
   *Advanced → Post Deployment Command*.

8. Deploy. Confirm the health check at
   `http://<server>:4000/health` returns `{"status":"ok","db":"ok"}`.

### B3. Frontend application

1. **+ New → Resource → Application**.
2. **Build Pack**: `Dockerfile`.
3. **Dockerfile Location**: `frontend/Dockerfile`.
4. **Port Exposed**: `80` (container port). Coolify will map it to 80/443
   on the host.
5. **Build Arguments**:
   - `VITE_API_URL` — leave **empty**. The SPA uses first-party-relative
     URLs (`/api/v1/...`) and nginx's `/api/` location proxies them to the
     backend. **Do not set this to `/api`** — the call paths already start
     with `/api/v1/...`, so a `/api` prefix would produce `/api/api/v1/...`
     and miss the backend. Set it only if you intentionally want the SPA
     to call a backend hosted on a different origin (e.g. a staging API).
6. **Environment Variables**:
   - `BACKEND_UPSTREAM=crewlog-backend:4000` (Coolify internal DNS,
     matching the resource name you picked in B2 — adjust if you renamed
     it). Must be `host:port` with **no scheme** — the nginx `server`
     directive inside `upstream` blocks rejects URLs.
7. **Domains**: add `crewlog.yourdomain`, enable Let's Encrypt.
8. Deploy.

> The internal hostname Coolify picks depends on the resource name you
> chose. If you called the backend resource `crewlog-api` instead, set
> `BACKEND_UPSTREAM=crewlog-api:4000`.

---

## 3. Smoke tests

Once everything is green:

```bash
# Health (from anywhere on the network that can reach the server)
curl -sS https://crewlog.yourdomain/nginx-health
curl -sS https://crewlog.yourdomain/api/v1/../health
# → {"status":"ok","db":"ok"}

# Login (seeded demo user)
curl -sS -X POST https://crewlog.yourdomain/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@crewlog.local","password":"Admin123!"}'
```

Open the URL in a browser, log in with one of the demo accounts in the
main README, and confirm the Timesheet page renders.

---

## 4. Backups & upgrades

- **Postgres**: Coolify's built-in scheduler handles backups. Add one in
  the *Database* resource settings (e.g. nightly, retain 14).
- **Uploads**: `crewlog_uploads` is a Docker volume. Snapshot it via
  `docker run --rm -v crewlog_uploads:/data -v $PWD:/backup alpine \
  tar czf /backup/uploads-$(date +%F).tgz -C /data .` on a schedule.
- **Upgrades**: push to `main`. Coolify auto-rebuilds and re-runs the
  post-deployment migration command.

---

## 5. Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| Backend container exits with `DATABASE_URL is not set` | Env var missing or has a typo in the Coolify UI |
| `pg_isready` fails forever | `POSTGRES_PASSWORD` mismatch between the DB resource and the backend's `DATABASE_URL` |
| 401 on every API call from the SPA | `CORS_ORIGINS` set to the public hostname, but the browser is calling via the `/api` proxy — clear `CORS_ORIGINS` |
| Browser shows `Not allowed by CORS` on every API call | `CORS_ORIGINS` is empty in production, or doesn't include the SPA's actual origin. Backend startup logs a `WARN` line if this is the case. |
| `Bind for 0.0.0.0:80 failed: port is already allocated` on `frontend` | Coolify/Traefik already owns host port 80. Set `FRONTEND_PORT=<n>` (default is 8080) in the resource's env vars and redeploy. |
| 502 from nginx | Backend hasn't finished booting yet, or `BACKEND_UPSTREAM` points at the wrong service name |
| Nginx crash-loops with `host not found in upstream "BACKEND_UPSTREAM"` | Either (a) `BACKEND_UPSTREAM` is unset, or (b) the value includes an `http://` scheme — it must be `host:port` only, since the nginx template substitutes it into a `server` directive |
| Upload returns 413 | `UPLOAD_MAX_BYTES` too low or `client_max_body_size` in `frontend/nginx.conf` too small (default 32M) |
| Migrations ran twice / conflict | Safe to ignore — Knex records applied migrations in `knex_migrations` |

That's it — happy logging.