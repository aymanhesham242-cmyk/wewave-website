-- WeWave case study simulator storage.
--
-- The Worker creates this automatically on the first read or write, so you do
-- not normally need to run it by hand. It is kept as the readable record of the
-- schema, and for rebuilding the database from scratch:
--
--   npx wrangler d1 execute wewave-meetings --remote --file schema/case_studies.sql
--
-- Nothing here touches the existing `meetings`, `submit_log` or `a_*` tables.
--
-- These rows hold HYPOTHETICAL figures used to build and present case studies.
-- They are not reported performance from any advertising platform, and nothing
-- in the application fetches or writes real ad data.

-- One row per case study. The document is the whole tree -- campaigns, ad sets
-- and ads -- as JSON, because its shape belongs to the client-side engine in
-- `admin/case-studies/engine.js` and is normalised there on every read. Storing
-- it as one document keeps the two from drifting apart.
CREATE TABLE IF NOT EXISTS case_study (
  id          TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,

  -- Denormalised header fields, so the library list renders without parsing
  -- every document. Written from the document on each save.
  brand       TEXT,
  title       TEXT,
  industry    TEXT,
  objective   TEXT,
  currency    TEXT,
  start_date  TEXT,
  end_date    TEXT,

  -- Denormalised headline totals, supplied by the client from the same
  -- calculation engine that renders the dashboard. Display only: the document
  -- is always the source of truth, and is recalculated when it is opened.
  spend       REAL    NOT NULL DEFAULT 0,
  results     INTEGER NOT NULL DEFAULT 0,
  revenue     REAL    NOT NULL DEFAULT 0,
  roas        REAL,
  campaigns   INTEGER NOT NULL DEFAULT 0,

  doc         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_case_updated ON case_study (updated_at DESC);
