# Hosting: getting a permanent public URL

This project is a **single web process** (FastAPI serving the API *and* the compiled SPA) plus a **database**. Any host that can run a container or a Python process works. Nothing here requires a separate static host or a second service.

> **Why the preview link keeps dying:** `*.e2b.app` URLs point at an ephemeral coding sandbox. When the sandbox pauses or is recreated the URL is gone — that is not an application fault. The app itself starts in about two seconds and answers `200` on every route. For a link that survives, pick one of the options below.

---

## Option A — Render, one click from GitHub (recommended, free tier available)

The repository is public and already contains a `Dockerfile` and a `render.yaml` blueprint, so Render can build and run everything from the GitHub URL.

1. Sign in to <https://render.com> with GitHub (no card needed for the free tier).
2. Open the blueprint with your repo pre-filled:

   <https://render.com/deploy?repo=https://github.com/trigosin30-arch/gouresh>

   Or: **New → Blueprint**, pick `trigosin30-arch/gouresh`, branch `arena/65ddf089-gouresh` (or `main` once merged).
3. Render reads `render.yaml` and proposes:
   * a **PostgreSQL** instance (`asm-db`),
   * a **Docker web service** (`ankit-stationery-mart`) built from `Dockerfile`.
4. When prompted, set `DEMO_ADMIN_PASSWORD` and `DEMO_CUSTOMER_PASSWORD` (any strong values — you need them to sign in). `SECRET_KEY` is generated automatically; `DATABASE_URL` is wired from the database.
5. **Apply**. The first build takes 3–6 minutes (Node build → Python runtime → `alembic upgrade head`).
6. Your URL appears on the service page: `https://ankit-stationery-mart.onrender.com`.

**Signing in after deploy**

| Account | Email | Password |
| --- | --- | --- |
| Administrator | `demo.admin@example.com` | the `DEMO_ADMIN_PASSWORD` you set |
| Customer | `demo.customer@example.com` | the `DEMO_CUSTOMER_PASSWORD` you set |
| Seller | `demo.seller@example.com` | same as the customer password |

Open `/admin` for the panel. Because `SEED_DEMO=1`, the catalogue is sample data with visible “SAMPLE DATA — demo mode” labels and a demo banner.

**Honest free-tier limits**

* The free web service **sleeps after ~15 minutes idle**; the next visit takes ~30 seconds.
* The filesystem is **ephemeral** — uploaded photos disappear on redeploy. Attach a Render disk (paid) mounted at `/app/data` if uploads must persist.
* Render's free Postgres is time-limited; before real trading, move to a paid database or an external Postgres (Neon, Supabase, RDS) and set `DATABASE_URL` manually (the app accepts `postgres://`, `postgresql://` and `postgresql+psycopg://`).
* Razorpay and SMTP stay disabled until you add the secrets — the storefront then offers COD/pickup only, and notifications show `skipped` instead of pretending they were sent.

---

## Option B — Your own server / VPS with Docker Compose

Works on any ₹300–500/month VPS, a spare office PC with a static IP, or a home server behind Cloudflare Tunnel.

```bash
git clone https://github.com/trigosin30-arch/gouresh.git
cd gouresh
cp .env.example .env
nano .env          # set SECRET_KEY, POSTGRES_PASSWORD, SEED_DEMO, passwords
docker compose up -d --build
```

`docker-compose.yml` starts PostgreSQL 16 and the app, runs migrations on boot, and keeps the database and uploads in named volumes. The site is on `http://<server>:8000`; put nginx + Certbot in front for HTTPS (full walkthrough: [`DEPLOYMENT.md`](DEPLOYMENT.md)).

Without Docker, the same app runs under systemd — see [`DEPLOYMENT.md`](DEPLOYMENT.md) §7 for the unit file, nginx config and TLS steps.

---

## Option C — Fly.io

`fly.toml` is included (Mumbai region, health check on `/healthz`).

```bash
fly auth login
fly launch --no-deploy --copy-config --name ankit-stationery-mart
fly postgres create --name asm-db
fly postgres attach asm-db
fly secrets set SECRET_KEY="$(python -c 'import secrets;print(secrets.token_urlsafe(48))')" \
                SEED_DEMO=1 DEMO_ADMIN_PASSWORD=... DEMO_CUSTOMER_PASSWORD=...
fly deploy
```

Fly requires a payment method. Uploads are ephemeral unless you create a volume and uncomment the `[[mounts]]` block in `fly.toml`.

---

## What I can and cannot do from this session

* **Done:** the deployment artifacts (`Dockerfile`, `render.yaml`, `docker-compose.yml`, `fly.toml`, CI workflow), Postgres driver wiring, `postgres://` URL normalisation, and the code pushed to GitHub.
* **Cannot do:** create an account, accept a provider's terms, or enter payment details on your behalf. This sandbox also has no outbound access to Render/Fly/Docker Hub/Cloudflare, so it cannot deploy or tunnel the app itself — only GitHub is reachable.

The steps above are the shortest path: one Git provider login, one blueprint apply.

---

## After the first deploy — do this before showing customers

1. Sign in as the administrator and open **Admin → Store settings**. Publish the real phone number, email, opening hours, delivery PIN codes/fee, cancellation and return windows. Anything left blank shows as “not configured” on the storefront — by design.
2. Set `SEED_DEMO=0` and remove the demo products, listings and banners (or start from an empty database).
3. Create your own administrator (`python -m app.cli create-admin --email owner@example.com`) and restrict or delete the demo accounts.
4. Add `RAZORPAY_*` secrets only after testing in the gateway's test mode; leave them empty to keep online payment honestly unavailable.
5. Configure `SMTP_*` so order emails are actually sent, and confirm in **Admin → Audit & notifications** that statuses read `sent`.
6. Set up backups — see [`BACKUP_RESTORE.md`](BACKUP_RESTORE.md). On managed hosts, enable the provider's automated backups *and* copy the uploads directory somewhere durable.

## Verifying a fresh deployment

```bash
curl -fsS https://YOUR-DOMAIN/healthz                 # 200 + empty body
curl -fsS https://YOUR-DOMAIN/api/health | jq         # status ok, database ok
curl -s  https://YOUR-DOMAIN/api/admin/dashboard -o /dev/null -w '%{http_code}\n'   # 401
curl -fsS https://YOUR-DOMAIN/sitemap.xml | head -3
```

Then place one real test order (pickup + COD), move it through `packed → delivered` in the admin panel, and confirm the COD amount is recorded as collected.
