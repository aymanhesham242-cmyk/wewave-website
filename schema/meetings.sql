-- WeWave — the booking tables.
--
-- These two predate the schema folder: they were created by hand in the D1
-- console, so until now the only record of their shape was the SQL embedded in
-- worker/index.js. That is a recovery gap — a lost or rebuilt database had no
-- source of truth to restore from. This file closes it.
--
-- RECONSTRUCTED from the queries in worker/index.js, not dumped from the live
-- database. Every statement is IF NOT EXISTS, so running it against the
-- existing database is a no-op; it is safe to apply and safe to re-apply.
--
-- Verify it against production before trusting it for recovery:
--   npx wrangler d1 execute wewave-meetings --remote \
--     --command "SELECT sql FROM sqlite_master WHERE type='table'"

-- One row per booking request. `status` is moved through
-- new -> contacted -> booked -> archived from the admin panel; `notes` is the
-- internal scratch field beside each row there.
CREATE TABLE IF NOT EXISTS meetings (
  id           TEXT PRIMARY KEY,     -- crypto.randomUUID() from the Worker
  created_at   TEXT NOT NULL,        -- ISO 8601, assigned server-side
  name         TEXT NOT NULL,
  brand_link   TEXT NOT NULL,
  phone        TEXT NOT NULL,
  services     TEXT NOT NULL,        -- JSON array of service names
  meeting_date TEXT NOT NULL,        -- YYYY-MM-DD, validated to be not in the past
  message      TEXT,
  status       TEXT NOT NULL DEFAULT 'new',
  notes        TEXT NOT NULL DEFAULT ''
);

-- The panel lists newest first and counts by status.
CREATE INDEX IF NOT EXISTS idx_meetings_created ON meetings (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_meetings_status  ON meetings (status);

-- Rate limiting for every public and admin-auth route. `ip` is NOT an address:
-- it is the first 16 bytes of SHA-256 over "<bucket>|<address>", so repeats
-- from one source can be counted without keeping a log of who visited. Rows
-- older than an hour are pruned opportunistically by the Worker.
CREATE TABLE IF NOT EXISTS submit_log (
  ip TEXT    NOT NULL,
  at INTEGER NOT NULL               -- epoch seconds
);

-- Added when the analytics ingest started sharing this table: that route reads
-- it on every request, which is far too often for a scan.
CREATE INDEX IF NOT EXISTS idx_submit_log_ip_at ON submit_log (ip, at);
