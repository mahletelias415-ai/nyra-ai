CREATE TABLE nyra_scout_drafts (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, run_id TEXT NOT NULL UNIQUE,
 prompt TEXT NOT NULL, title TEXT NOT NULL, conditions TEXT NOT NULL,
 unsupported TEXT NOT NULL, questions TEXT NOT NULL, created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'review', revision INTEGER NOT NULL DEFAULT 1,
 mission_id TEXT
);
--> statement-breakpoint
CREATE INDEX nyra_scout_drafts_user ON nyra_scout_drafts(user_id,created_at);
