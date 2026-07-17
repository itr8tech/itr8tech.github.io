// PathCurator v2 schema (P1). Validated against real data (2026-07-14):
// content_type enum includes 'Participate'. Secrets live OUTSIDE SQLite (IndexedDB).
export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
CREATE TABLE schema_meta ( key TEXT PRIMARY KEY, value TEXT NOT NULL ) STRICT;

CREATE TABLE workspaces (              -- one connected org GitHub repo (PAT lives in PathCuratorSecrets)
  id TEXT PRIMARY KEY,
  org_label TEXT NOT NULL,
  owner TEXT, repo TEXT,
  branch TEXT NOT NULL DEFAULT 'main',
  path TEXT NOT NULL DEFAULT '',
  username TEXT, colour TEXT,
  sort_order INTEGER NOT NULL,
  created_at INTEGER
) STRICT;

CREATE TABLE attachments (
  id TEXT PRIMARY KEY, mime TEXT NOT NULL, bytes BLOB NOT NULL,
  byte_len INTEGER NOT NULL, sha256 TEXT, created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE pathways (
  id TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  content_warning TEXT NOT NULL DEFAULT '',
  acknowledgments TEXT NOT NULL DEFAULT '',
  header_image_id TEXT REFERENCES attachments(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL,
  created_at INTEGER, last_updated INTEGER,
  version TEXT, created_by TEXT, modified_by TEXT,
  extra_json TEXT
) STRICT;
CREATE UNIQUE INDEX ux_pathways_order ON pathways(workspace_id, sort_order);

CREATE TABLE steps (
  id TEXT PRIMARY KEY,
  pathway_id TEXT NOT NULL REFERENCES pathways(id) ON DELETE CASCADE,
  name TEXT NOT NULL, objective TEXT NOT NULL DEFAULT '',
  pause_and_reflect TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL, extra_json TEXT
) STRICT;
CREATE INDEX idx_steps_pathway ON steps(pathway_id);
CREATE UNIQUE INDEX ux_steps_order ON steps(pathway_id, sort_order);

CREATE TABLE bookmarks (
  id TEXT PRIMARY KEY,
  step_id TEXT NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '', url TEXT NOT NULL, url_norm TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '', context TEXT NOT NULL DEFAULT '',
  required INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0,1)),
  content_type TEXT NOT NULL DEFAULT 'Read' CHECK (content_type IN ('Read','Watch','Listen','Participate')),
  added_at INTEGER, sort_order INTEGER NOT NULL,
  last_checked INTEGER,
  available INTEGER CHECK (available IN (0,1)),
  http_status INTEGER, status_label TEXT, redirect_url TEXT, check_error TEXT,
  requires_auth INTEGER CHECK (requires_auth IN (0,1)),
  check_method TEXT, check_duration INTEGER, extra_json TEXT
) STRICT;
CREATE INDEX idx_bookmarks_step ON bookmarks(step_id);
CREATE UNIQUE INDEX ux_bookmarks_order ON bookmarks(step_id, sort_order);
CREATE INDEX idx_bookmarks_url ON bookmarks(url_norm);
CREATE INDEX idx_bookmarks_audit ON bookmarks(last_checked);

CREATE TABLE version_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pathway_id TEXT NOT NULL REFERENCES pathways(id) ON DELETE CASCADE,
  hash TEXT NOT NULL, timestamp INTEGER NOT NULL,
  step_count INTEGER, bookmark_count INTEGER, modified_by TEXT
) STRICT;
CREATE INDEX idx_history_pathway ON version_history(pathway_id, timestamp DESC);
CREATE TRIGGER trg_version_cap AFTER INSERT ON version_history BEGIN
  DELETE FROM version_history WHERE pathway_id = NEW.pathway_id AND id NOT IN (
    SELECT id FROM version_history WHERE pathway_id = NEW.pathway_id
    ORDER BY timestamp DESC, id DESC LIMIT 10);
END;

CREATE TABLE inbox (
  id TEXT PRIMARY KEY, url TEXT NOT NULL, url_norm TEXT NOT NULL,
  title TEXT, note TEXT, description TEXT,
  image_url TEXT, image_blob_id TEXT REFERENCES attachments(id) ON DELETE SET NULL,
  content_type TEXT DEFAULT 'Read' CHECK (content_type IN ('Read','Watch','Listen','Participate')),
  source TEXT CHECK (source IN ('extension','bookmarklet','share-target','protocol','file','manual')),
  ref TEXT, status TEXT NOT NULL DEFAULT 'unsorted' CHECK (status IN ('unsorted','triaged','dismissed')),
  sort_order INTEGER, created_at INTEGER NOT NULL, triaged_at INTEGER,
  filed_bookmark_id TEXT REFERENCES bookmarks(id) ON DELETE SET NULL
) STRICT;
CREATE UNIQUE INDEX ux_inbox_ref ON inbox(ref);
CREATE INDEX idx_inbox_status ON inbox(status, created_at DESC);

CREATE TABLE exempt_domains ( domain TEXT PRIMARY KEY, reason TEXT NOT NULL DEFAULT '' ) STRICT;
CREATE TABLE settings ( key TEXT PRIMARY KEY, value TEXT ) STRICT;
`;

export const TABLES = ['version_history','bookmarks','steps','pathways','inbox','attachments','exempt_domains','settings','workspaces','schema_meta'];
