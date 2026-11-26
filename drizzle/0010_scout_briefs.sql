CREATE TABLE nyra_scout_brief_settings (
 user_id TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 0,
 hour_utc INTEGER NOT NULL DEFAULT 4,revision INTEGER NOT NULL DEFAULT 0,
 next_at INTEGER,updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX nyra_scout_brief_due ON nyra_scout_brief_settings(enabled,next_at);
--> statement-breakpoint
CREATE TABLE nyra_scout_briefs (
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL,slot TEXT,payload TEXT NOT NULL,
 created_at INTEGER NOT NULL,UNIQUE(user_id,slot)
);
--> statement-breakpoint
CREATE INDEX nyra_scout_briefs_user ON nyra_scout_briefs(user_id,created_at DESC);
