# Backup and restore

Two things must be backed up together: **the database** and **the uploads directory**. Restoring one without the other produces orders whose images 404 or listings whose rows are missing.

Backups are only real once a restore drill has succeeded. Do the drill in `docs/BACKUP_RESTORE.md` §5 before launch and every quarter.

## 1. What to back up

| Path / store | Content | If lost |
| --- | --- | --- |
| `DATABASE_URL` (PostgreSQL `asm_store`, or SQLite file) | Accounts, catalogue, orders, payments, commissions, audits | Unrecoverable business records |
| `UPLOAD_DIR` (e.g. `/srv/asm/data/uploads`) | Product photos, listing photos, submission photos | Images gone; listings become unpublishable |
| `/srv/asm/asm.env` (securely, separately) | `SECRET_KEY`, DB password, gateway/SMTP keys | Cannot decrypt sessions; must rotate keys |
| `frontend/dist` + code | The application itself | Rebuildable from Git, not a backup concern |

Do **not** copy a live SQLite file with plain `cp`; use the online backup API (the script does).

## 2. Scripted backup

`scripts/backup.sh` creates a timestamped directory containing the database dump, a tarball of uploads, and a manifest, then prunes old copies.

```bash
sudo install -m 750 -o asm -g asm scripts/backup.sh /srv/asm/backup.sh
sudo -u asm BACKUP_ROOT=/srv/asm/data/backups RETENTION_DAYS=30 \
  $(grep -v '^#' /srv/asm/asm.env | xargs) /srv/asm/backup.sh
```

For PostgreSQL it uses `pg_dump -Fc` (custom format, compressed, restorable with `pg_restore`). For SQLite it uses Python's `sqlite3.Connection.backup`, which is safe against concurrent writers. Uploads are archived with `tar czf` while the app keeps running (files are written to unique names, so the archive is internally consistent).

Example cron entry (03:15 daily, as the app user):

```cron
15 3 * * * BACKUP_ROOT=/srv/asm/data/backups RETENTION_DAYS=30 /srv/asm/backup.sh >> /srv/asm/data/backups/backup.log 2>&1
```

Copy backups off the machine — a backup on the same disk is not a backup:

```bash
rclone copy /srv/asm/data/backups remote:asm-backups --include "asm-*"
```

## 3. Manual commands

### PostgreSQL

```bash
pg_dump --format=custom --no-owner --no-acl \
  --file=/srv/asm/data/backups/asm-manual-$(date +%F).dump "$DATABASE_URL_POSTGRES"
```

### SQLite

```bash
python - <<'PY'
import sqlite3
src = sqlite3.connect("/srv/asm/data/asm.db")
dst = sqlite3.connect("/srv/asm/data/backups/asm-manual.db")
with dst:
    src.backup(dst)
dst.close(); src.close()
PY
```

### Uploads

```bash
tar czf /srv/asm/data/backups/uploads-manual-$(date +%F).tar.gz -C /srv/asm/data uploads
```

## 4. Retention

* Daily backups: 14–30 days (`RETENTION_DAYS`).
* Monthly archive: keep 12 months, copied off-site.
* Keep at least one backup from **before** every application update and every Alembic migration.
* Encrypt off-site copies (`age`/`gpg`) and store the key separately from the data.

## 5. Restore drill (required before launch)

Do this on a staging host, never on production first.

```bash
# 1. Stop the app so nothing writes during the restore
sudo systemctl stop asm

# 2. Restore the database
createdb -O asm_user asm_store_restore_test
pg_restore --no-owner --no-acl -d asm_store_restore_test /srv/asm/data/backups/asm-2026-10-20-031500/store.dump

# 3. Restore uploads into a scratch directory
mkdir -p /tmp/uploads-restore
tar xzf /srv/asm/data/backups/asm-2026-10-20-031500/uploads.tar.gz -C /tmp/uploads-restore

# 4. Point a temporary instance at the restored data and verify
cd /srv/asm/app/backend
DATABASE_URL="postgresql+psycopg://asm_user:PASSWORD@127.0.0.1:5432/asm_store_restore_test" \
UPLOAD_DIR=/tmp/uploads-restore/uploads \
APP_ENV=production SECRET_KEY="drill-only-secret-key" \
  /srv/asm/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8099 &

curl -fsS http://127.0.0.1:8099/healthz
```

Verify in the temporary instance:

1. `/api/admin/dashboard` after signing in with a known account shows plausible order counts.
2. An order detail page loads and its invoice renders (`/api/admin/orders/{id}/document?kind=invoice`).
3. A product image from the restored uploads directory returns `200` and `image/jpeg`.
4. Row counts match the source within the expected backup lag:

```bash
psql asm_store_restore_test -c "select
  (select count(*) from users) users,
  (select count(*) from products) products,
  (select count(*) from orders) orders,
  (select count(*) from order_items) items,
  (select count(*) from commissions) commissions;"
```

5. Stop the temporary instance and drop the scratch database.

```bash
kill %1
dropdb asm_store_restore_test
```

Record the drill: date, backup used, row counts, who ran it, anything that failed.

## 6. Real restore (production)

```bash
sudo systemctl stop asm
sudo -u asm /srv/asm/backup.sh                       # safety net of the current state first
psql -c "DROP DATABASE asm_store;"                    # only after the safety backup exists
createdb -O asm_user asm_store
pg_restore --no-owner --no-acl -d asm_store /path/to/store.dump

sudo rm -rf /srv/asm/data/uploads && sudo mkdir -p /srv/asm/data/uploads
sudo tar xzf /path/to/uploads.tar.gz -C /srv/asm/data --strip-components=1 --one-top-level=uploads_pending
# (simplest reliable variant: extract then move)
sudo tar xzf /path/to/uploads.tar.gz -C /srv/asm/data
sudo chown -R asm:asm /srv/asm/data/uploads

cd /srv/asm/app/backend
sudo -u asm env $(grep -v '^#' /srv/asm/asm.env | xargs) /srv/asm/venv/bin/alembic upgrade head
sudo systemctl start asm
curl -fsS https://shop.example.com/healthz
```

Then place one test order and verify it appears in the admin panel.

For SQLite, restore by stopping the service, replacing `asm.db` with the `store.db` copy, and also **deleting** stale `asm.db-wal` / `asm.db-shm` files from the previous database (leaving them causes corruption warnings).

## 7. Recovery objectives (starter targets)

| Objective | Target | How |
| --- | --- | --- |
| RPO (max data loss) | 24 hours daily, 1 hour if WAL/PITR archiving is enabled | Daily backup + PostgreSQL WAL archiving |
| RTO (time to restore) | < 2 hours for this dataset size | Practised drill, documented commands |

PostgreSQL point-in-time recovery requires WAL archiving (`archive_mode=on`) plus periodic base backups — configure it if the shop cannot tolerate a day of lost orders.

## 8. Secrets

Back up `.env` separately from the database (it contains `SECRET_KEY` and payment keys). If it is lost:

* Sessions become invalid after `SECRET_KEY` rotation — acceptable, everyone signs in again.
* Payment webhook signing fails until the gateway secret is re-entered — the webhook responds `400`, and the gateway retries.
* Never store the env backup in the same bucket or directory as the database dump.
