# Deployment guide

Target: one small Linux VM (2 vCPU / 2 GB RAM is plenty) running nginx + a single FastAPI process, with PostgreSQL and a persistent uploads directory.

Commands below were exercised in this repository's sandbox against SQLite. PostgreSQL-specific steps follow the documented `DATABASE_URL` + Alembic path but were **not** executed here because no PostgreSQL server was available — run them on staging first.

---

## 1. Prerequisites

```bash
sudo apt update
sudo apt install -y python3.11 python3.11-venv python3-pip nginx postgresql postgresql-contrib certbot python3-certbot-nginx git
```

Node is only needed on the build machine (or on the server once, to build `frontend/dist`).

## 2. Database

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE asm_user LOGIN PASSWORD 'replace-with-a-long-random-password';
CREATE DATABASE asm_store OWNER asm_user;
SQL
```

Install the driver in the virtualenv:

```bash
pip install "psycopg[binary]==3.2.3"
```

`DATABASE_URL=postgresql+psycopg://asm_user:...@127.0.0.1:5432/asm_store`

SQLite is fine for a single-shop pilot, but PostgreSQL is recommended for concurrent staff use and reliable backups. Never point production at the demo database.

## 3. Application user and code

```bash
sudo useradd --system --create-home --home-dir /srv/asm --shell /usr/sbin/nologin asm
sudo -u asm git clone <repository-url> /srv/asm/app
cd /srv/asm/app

sudo -u asm python3.11 -m venv /srv/asm/venv
sudo -u asm /srv/asm/venv/bin/pip install --upgrade pip
sudo -u asm /srv/asm/venv/bin/pip install -r backend/requirements.txt
```

Create persistent directories:

```bash
sudo install -d -o asm -g asm -m 750 /srv/asm/data/uploads /srv/asm/data/backups /srv/asm/run
```

## 4. Build the frontend

```bash
cd /srv/asm/app/frontend
sudo -u asm npm ci
sudo -u asm npm run build          # writes frontend/dist
```

`FRONTEND_DIST` defaults to `<repo>/frontend/dist`, which is what FastAPI serves. The admin bundle is lazy-loaded, so customers never download it.

## 5. Environment

```bash
sudo install -m 600 -o asm -g asm /dev/null /srv/asm/asm.env
sudo -u asm nano /srv/asm/asm.env
```

```ini
APP_ENV=production
SECRET_KEY=<output of: python -c "import secrets; print(secrets.token_urlsafe(48))">
DATABASE_URL=postgresql+psycopg://asm_user:PASSWORD@127.0.0.1:5432/asm_store
UPLOAD_DIR=/srv/asm/data/uploads
FRONTEND_DIST=/srv/asm/app/frontend/dist
PUBLIC_SITE_URL=https://shop.example.com
SECURE_COOKIES=1
SEED_DEMO=0
# Optional: online payments (all three required)
# RAZORPAY_KEY_ID=
# RAZORPAY_KEY_SECRET=
# RAZORPAY_WEBHOOK_SECRET=
# Optional: email
# SMTP_HOST=smtp.example.com
# SMTP_PORT=587
# SMTP_USERNAME=
# SMTP_PASSWORD=
# SMTP_FROM="Ankit Stationery Mart <orders@example.com>"
# SMTP_STARTTLS=1
```

`APP_ENV=production` forces secure cookies, refuses to start without `SECRET_KEY`, and turns off the development console notification provider.

## 6. Migrate and bootstrap the administrator

```bash
cd /srv/asm/app/backend
sudo -u asm env $(grep -v '^#' /srv/asm/asm.env | xargs) /srv/asm/venv/bin/alembic upgrade head
sudo -u asm -H env $(grep -v '^#' /srv/asm/asm.env | xargs) \
  /srv/asm/venv/bin/python -m app.cli create-admin --email owner@example.com
```

The CLI prompts for a password (minimum 10 characters) and stores only an Argon2 hash. There is no default password anywhere in the codebase.

## 7. systemd service

`/etc/systemd/system/asm.service`:

```ini
[Unit]
Description=Ankit Stationery Mart web app
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=asm
Group=asm
WorkingDirectory=/srv/asm/app/backend
EnvironmentFile=/srv/asm/asm.env
ExecStart=/srv/asm/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1 --proxy-headers --forwarded-allow-ips=127.0.0.1
Restart=always
RestartSec=3
RuntimeDirectory=asm
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=/srv/asm/data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now asm
sudo systemctl status asm
```

**Run one worker.** Rate limiting and the stock-reservation sweeper are in-process. If you need more concurrency, move rate limits to Redis first and keep the sweeper in one process.

## 8. nginx + TLS

`/etc/nginx/sites-available/asm`:

```nginx
server {
    listen 80;
    server_name shop.example.com;
    client_max_body_size 5m;          # uploads are capped at 4 MB by the app

    # Uploaded images can be served directly by nginx for speed
    location /uploads/ {
        alias /srv/asm/data/uploads/;
        expires 30d;
        add_header Cache-Control "public";
        try_files $uri =404;
    }

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/asm /etc/nginx/sites-enabled/asm
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d shop.example.com
```

Certbot adds the HTTPS block and redirect. HSTS is sent by the app when secure cookies are enabled.

## 9. Verify the deployment

```bash
curl -fsS https://shop.example.com/healthz
curl -fsS https://shop.example.com/api/health
curl -fsS https://shop.example.com/sitemap.xml | head
curl -sI https://shop.example.com/admin | head -1      # 200, SPA shell
curl -s  https://shop.example.com/api/admin/dashboard   # 401 without a session
```

Then, in a browser:

1. Sign in at `/login` with the administrator created above.
2. Open `/admin` → **Store settings** and publish the real phone, email, opening hours, delivery PIN codes and fee, and policy notes. Anything left blank stays visibly “not configured” on the storefront.
3. Create a real product, place a test order for pickup, and take it through the status flow.
4. Confirm `Admin → Audit & notifications` shows the actions you performed.
5. Remove or replace any demo/sample content if the database was ever seeded (`SEED_DEMO` must be off in production).

## 10. Updates

```bash
cd /srv/asm/app
sudo -u asm git fetch --all && sudo -u asm git checkout <release-tag>
sudo -u asm /srv/asm/venv/bin/pip install -r backend/requirements.txt
cd frontend && sudo -u asm npm ci && sudo -u asm npm run build && cd ..
cd backend
sudo -u asm env $(grep -v '^#' /srv/asm/asm.env | xargs) /srv/asm/venv/bin/alembic upgrade head
sudo systemctl restart asm
```

Keep the previous release directory (or a git tag) so you can roll back the code. Rolling back a migration requires a database backup first — see `docs/BACKUP_RESTORE.md`.

## 11. Logs and monitoring

```bash
journalctl -u asm -f
journalctl -u nginx -f
ls -lh /srv/asm/data/uploads
```

Useful checks:

* `/healthz` from an external monitor every minute.
* Disk space for `UPLOAD_DIR` and backups.
* `Admin → Dashboard` setup checklist for unconfigured business facts.
* `Admin → Audit & notifications` for notification `failed` rows.

## 12. Scaling notes

* Multiple app workers: rate limits become per-worker (weaker) and the reservation sweeper runs in each. Either run one worker, or add Redis-backed limits and a single scheduler.
* Multiple app servers: session cookies are opaque tokens stored in the database, so they work across servers, but the in-process rate limiter does not. Use shared storage for limits.
* Uploads must be on shared storage (or an object store) if you run more than one server.
* Static assets are served by FastAPI; putting nginx or a CDN in front of `/assets/` is recommended for heavy traffic.

## 13. Go-live checklist

- [ ] `APP_ENV=production`, strong `SECRET_KEY`, `SECURE_COOKIES=1`
- [ ] PostgreSQL database with a dedicated role; migrations applied (`alembic upgrade head`)
- [ ] Real administrator created via CLI; demo accounts removed
- [ ] `SEED_DEMO=0`; sample products, listings, banners and FAQs replaced
- [ ] Store phone, email, opening hours, delivery PINs/fee, cancellation and return windows published in settings
- [ ] Shipping/returns/privacy/terms pages reviewed against the store's actual practice
- [ ] Backups configured and a restore drill completed
- [ ] Test order placed, fulfilled and refunded end-to-end
- [ ] Email provider configured (or staff aware that email notifications are stored, not sent)
- [ ] Payment gateway configured and tested (or online payments left disabled)
- [ ] TLS certificate auto-renewal verified (`certbot renew --dry-run`)
