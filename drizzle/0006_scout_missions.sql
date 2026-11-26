CREATE TABLE nyra_scout_missions (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, conditions TEXT NOT NULL,
 paused INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER, revision INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL, next_at INTEGER NOT NULL, last_at INTEGER, checks INTEGER NOT NULL DEFAULT 0,
 error TEXT NOT NULL DEFAULT '', lease TEXT, lease_until INTEGER
);
--> statement-breakpoint
CREATE INDEX nyra_scout_due ON nyra_scout_missions(deleted_at,paused,next_at);
--> statement-breakpoint
CREATE TABLE nyra_scout_candidates (
 address TEXT PRIMARY KEY, name TEXT NOT NULL, symbol TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 0,
 payload TEXT NOT NULL, discovered_at INTEGER NOT NULL, last_seen INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE nyra_scout_cache (key TEXT PRIMARY KEY,payload TEXT NOT NULL,expires_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE nyra_scout_runs (
 id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, user_id TEXT NOT NULL, started_at INTEGER NOT NULL,
 finished_at INTEGER, status TEXT NOT NULL DEFAULT 'running', payload TEXT NOT NULL DEFAULT '{}'
);
--> statement-breakpoint
CREATE INDEX nyra_scout_runs_user ON nyra_scout_runs(user_id,started_at);
--> statement-breakpoint
CREATE TABLE nyra_scout_results (
 id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, user_id TEXT NOT NULL, address TEXT NOT NULL,
 decision TEXT NOT NULL, payload TEXT NOT NULL, checked_at INTEGER NOT NULL,
 notified_at INTEGER, UNIQUE(mission_id,address)
);
--> statement-breakpoint
CREATE INDEX nyra_scout_results_user ON nyra_scout_results(user_id,checked_at);
