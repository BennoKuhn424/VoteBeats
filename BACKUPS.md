# Backups & Restore Drill

Live data lives in `DATA_DIR/speeldit.db` (SQLite, WAL mode). This doc covers
how backups happen, how to restore, and how to verify the whole loop works.

## What's in the backup

A single file: `speeldit.db`. It contains every venue, queue, vote, payment
record, subscription, payout, and analytics event. Nothing else needs to be
backed up — there is no "uploads" directory, and external state (Apple Music
catalog, Paystack/Yoco transactions) is the relevant provider's responsibility.

## How backups are taken

`server/scripts/backup-db.js` uses better-sqlite3's online backup API
(SQLite's `sqlite3_backup_*` functions). This is **not** a file copy — it
walks the live page set + WAL under read locks and writes a single,
fully-merged, consistent file at the destination. Safe to run while the
server is serving traffic.

A plain `cp` of `speeldit.db` while the server is running is **not safe**.
WAL mode means the most recent writes live in `speeldit.db-wal` and haven't
been merged into the main file yet. A copy of just `speeldit.db` would be
missing that data and would fail `integrity_check` on the next boot.

## Where backups live

`DATA_DIR/backups/speeldit-<UTC-timestamp>.db`, e.g.:

```
DATA_DIR/backups/speeldit-2026-05-04T14-06-12.db
```

The 14 most recent are kept; older backups are pruned automatically on each
run. Override retention with `BACKUP_RETENTION=N` in the environment.

## Cron / scheduled run

On Render's persistent-disk plan (or any host with cron), schedule:

```
0 3 * * * cd /opt/render/project/src/server && node scripts/backup-db.js
```

Adjust the path to wherever the server checkout lives. The script exits non-
zero on failure — wire that into your alerting (Render's "command exit code"
notifier, a wrapping script that pages on failure, etc.).

For environments without cron (e.g. some Render web-service plans), run the
backup as a **scheduled job**: a small worker that fires the script every
24h. Render's "Cron Job" service type does exactly this.

## How to restore

**1. Stop the server.** better-sqlite3 keeps the DB file open in WAL mode;
overwriting it under a running process produces undefined behaviour. On
Render: pause the service. On a self-hosted box: `systemctl stop <unit>`.

**2. Run the restore script:**

```bash
# List available backups
node server/scripts/restore-db.js

# Restore the most recent
node server/scripts/restore-db.js --latest

# Restore a specific backup by name
node server/scripts/restore-db.js speeldit-2026-05-04T14-06-12.db
```

The script:

1. Verifies the chosen backup with `PRAGMA integrity_check` and refuses to
   proceed if it's malformed.
2. Renames the current `speeldit.db` to `speeldit.db.pre-restore.<ts>` so a
   wrong restore is reversible.
3. Removes the old `-wal`/`-shm` sidecars (they belong to the old DB).
4. Copies the backup file into place as `speeldit.db`.

**3. Start the server.** It will open the restored DB normally. The
`utils/sqlite.js` open path runs `PRAGMA integrity_check` on existing files
and quarantines anything that looks damaged before applying the schema, so a
truly bad restore is caught at boot rather than corrupting writes silently.

## Restore drill (do this once a quarter)

Verifies the whole backup → restore loop end-to-end on a non-production
environment.

1. **Pick a recent backup** from `DATA_DIR/backups/`.
2. **Spin up a clean copy of the server** with `DATA_DIR=/tmp/restore-test`.
3. **Copy the backup into that DATA_DIR:**
   ```bash
   mkdir -p /tmp/restore-test/backups
   cp DATA_DIR/backups/speeldit-XXXX.db /tmp/restore-test/backups/
   DATA_DIR=/tmp/restore-test node server/scripts/restore-db.js --latest
   ```
4. **Start the server** with `DATA_DIR=/tmp/restore-test`.
5. **Smoke test:** log in as a known venue, view the queue, check that the
   queue + votes + subscription state look right.
6. **Verify integrity:** the boot logs should NOT contain
   `sqlite-integrity-check-failed` or `sqlite-corrupt`.
7. **Tear down** `/tmp/restore-test`.

If any step fails: the backup is bad and the rotation is silently broken.
Investigate the `backup-db.js` cron logs — the most common cause is the
script failing partway through and being silently overwritten the next night.

## Operational notes

- **Disk space.** Each backup is roughly the same size as the live DB (no
  compression). With 14 retained backups and a 100 MB live DB, expect
  ~1.4 GB consumed in `DATA_DIR/backups/`. Bump `BACKUP_RETENTION` only as
  needed; favour off-host archival instead of long retention here.
- **Off-host archival.** This script only writes to `DATA_DIR`. For
  disaster recovery (the host itself dies), additionally rclone/rsync the
  `backups/` directory to S3/B2/etc. on a separate cron line. We don't bake
  cloud upload into the script to keep it dependency-free.
- **Encryption at rest.** The DB is not encrypted on disk. Only the
  `pending_payments.song` / `device_id` columns use field-level encryption
  (when `PAYMENT_ENCRYPTION_KEY` is set). If your backups are stored
  off-host, treat the file as containing PII.
- **Auto-recovery is a last resort.** If the DB on disk fails
  `integrity_check` at boot, the server quarantines the corrupt file
  (renames it to `speeldit.db.corrupt.<ts>`) and starts fresh. **You will
  lose data** from the moment of the last good write to the moment of
  corruption — restore from a backup before resuming traffic. Don't let the
  fresh DB accumulate writes; those will overwrite what a clean restore
  would have brought back.
