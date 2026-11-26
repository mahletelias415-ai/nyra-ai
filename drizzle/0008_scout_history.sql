CREATE TABLE nyra_scout_observations (
 id TEXT PRIMARY KEY, result_id TEXT NOT NULL, mission_id TEXT NOT NULL,
 user_id TEXT NOT NULL, checked_at INTEGER NOT NULL, payload TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX nyra_scout_observations_result ON nyra_scout_observations(user_id,result_id,checked_at DESC,id);
