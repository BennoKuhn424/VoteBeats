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

**Every fresh backup is verified before it counts.** Right after writing, the
script reopens the new file read-only and runs `PRAGMA integrity_check`. If it
doesn't return `ok`, the backup is deleted and the script exits non-zero (code
4) so alerting fires — a silently-corrupt backup is worse than none.

Exit codes: `0` success · `1` no DB · `2` backup failed · `3` uncaught ·
`4` fresh backup failed integrity · `5` off-disk upload failed.

## Where backups live

`DATA_DIR/backups/speeldit-<UTC-timestamp>.db`, e.g.:

```
DATA_DIR/backups/speeldit-2026-05-04T14-06-12.db
```

The 14 most recent are kept; older backups are pruned automatically on each
run. Override retention with `BACKUP_RETENTION=N` in the environment.

> ⚠️ **`DATA_DIR/backups/` is on the SAME disk as the database.** If that disk
> fails, you lose the DB *and* every local backup with it. Local backups only
> protect against logical mistakes (bad migration, accidental delete), not
> hardware loss. For real disaster recovery you **must** also copy off-disk —
> see the next section.

## Off-disk copy (disaster recovery) — **set this up**

`backup-db.js` ships each verified backup off-box when `BACKUP_REMOTE_CMD` is
set. The command runs via the shell; the token `{file}` is replaced with the
absolute backup path and `{base}` with the filename. No SDK is bundled — use
whatever uploader you already have:

```bash
# Amazon S3
BACKUP_REMOTE_CMD='aws s3 cp {file} s3://my-bucket/speeldit/'

# Cloudflare R2 / Backblaze B2 / any S3-compatible store via rclone
BACKUP_REMOTE_CMD='rclone copy {file} r2:speeldit-backups/'

# Backblaze B2 CLI
BACKUP_REMOTE_CMD='b2 upload-file my-bucket {file} speeldit/{base}'
```

Set `BACKUP_REMOTE_CMD` (and the uploader's own credentials, e.g.
`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` or an `rclone.conf`) in the Render
environment. If the upload fails the script exits `5` but **keeps the local
copy**, so a transient network blip never loses the backup. Let the remote
handle long-term retention (S3 lifecycle / object-lock rules) — that also gives
you protection against ransomware/accidental deletion that local pruning can't.

If `BACKUP_REMOTE_CMD` is unset the script logs `LOCAL ONLY` and succeeds — fine
for dev, **not acceptable for production.**

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
- **Off-host archival.** Built into the script via `BACKUP_REMOTE_CMD` (see
  "Off-disk copy" above). It stays dependency-free by shelling out to your
  uploader of choice rather than bundling a cloud SDK.
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
