-- WeWave analytics tables.
--
-- The Worker creates these automatically on the first event it stores, so you
-- do not normally need to run this by hand. It is kept as the readable record
-- of the schema, and for rebuilding the database from scratch:
--
--   npx wrangler d1 execute wewave-meetings --remote --file schema/analytics.sql
--
-- Nothing here touches the existing `meetings` / `submit_log` tables.

-- One row per interaction. Kept deliberately flat: D1 is SQLite, and every
-- dashboard query is a straight aggregate over this table.
CREATE TABLE IF NOT EXISTS a_event (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         INTEGER NOT NULL,      -- epoch ms, assigned by the Worker, never the client
  session_id TEXT    NOT NULL,
  type       TEXT    NOT NULL,      -- PAGE_VIEW, CLICK, SECTION_VIEW, ...
  path       TEXT,
  section    TEXT,                  -- which stage was live when it happened
  element    TEXT,                  -- #id / .class / tag of the target
  label      TEXT,                  -- visible text, truncated; never form values
  x          REAL,                  -- viewport-normalised 0..1
  y          REAL,
  scroll     REAL,                  -- timeline progress 0..100
  vw         INTEGER,
  vh         INTEGER,
  device     TEXT,                  -- desktop | mobile | tablet
  browser    TEXT,
  os         TEXT,
  country    TEXT,                  -- from Cloudflare request metadata
  is_test    INTEGER NOT NULL DEFAULT 0,
  meta       TEXT                   -- small JSON for event-specific extras
);

CREATE INDEX IF NOT EXISTS idx_a_event_ts        ON a_event (ts);
CREATE INDEX IF NOT EXISTS idx_a_event_session   ON a_event (session_id, ts);
CREATE INDEX IF NOT EXISTS idx_a_event_type_ts   ON a_event (type, ts);
CREATE INDEX IF NOT EXISTS idx_a_event_heat      ON a_event (type, section, ts);

-- One row per anonymous session, updated as events arrive. Denormalised on
-- purpose so the sessions list and the funnel do not need to scan a_event.
CREATE TABLE IF NOT EXISTS a_session (
  id           TEXT PRIMARY KEY,
  started_at   INTEGER NOT NULL,
  last_at      INTEGER NOT NULL,
  entry_path   TEXT,
  exit_path    TEXT,
  pageviews    INTEGER NOT NULL DEFAULT 0,
  events       INTEGER NOT NULL DEFAULT 0,
  interactions INTEGER NOT NULL DEFAULT 0,   -- clicks / taps / CTA presses
  max_scroll   REAL    NOT NULL DEFAULT 0,
  device       TEXT,
  browser      TEXT,
  os           TEXT,
  country      TEXT,
  vw           INTEGER,
  vh           INTEGER,
  referrer     TEXT,
  ref_source   TEXT,                          -- google / instagram / direct / ...
  utm_source   TEXT,
  utm_medium   TEXT,
  utm_campaign TEXT,
  utm_content  TEXT,
  utm_term     TEXT,
  is_test      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_a_session_started ON a_session (started_at);
CREATE INDEX IF NOT EXISTS idx_a_session_last    ON a_session (last_at);
