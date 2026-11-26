ALTER TABLE nyra_agent_runs ADD COLUMN request_key TEXT;
--> statement-breakpoint
CREATE UNIQUE INDEX nyra_agent_request_key ON nyra_agent_runs(user_id,request_key) WHERE request_key IS NOT NULL;
--> statement-breakpoint
ALTER TABLE nyra_scout_drafts ADD COLUMN channel TEXT NOT NULL DEFAULT 'web';
--> statement-breakpoint
ALTER TABLE nyra_scout_drafts ADD COLUMN target_mission_id TEXT;
--> statement-breakpoint
ALTER TABLE nyra_scout_drafts ADD COLUMN target_revision INTEGER;
--> statement-breakpoint
ALTER TABLE nyra_scout_missions ADD COLUMN conditions_revision INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE nyra_scout_missions ADD COLUMN updated_at INTEGER;
--> statement-breakpoint
ALTER TABLE nyra_scout_results ADD COLUMN conditions_revision INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE nyra_telegram_updates ADD COLUMN user_id TEXT;
--> statement-breakpoint
ALTER TABLE nyra_telegram_updates ADD COLUMN reply_markup TEXT;
--> statement-breakpoint
CREATE TABLE nyra_telegram_scout_context (
 user_id TEXT PRIMARY KEY,chat_id TEXT NOT NULL,draft_id TEXT,mission_id TEXT,
 mission_revision INTEGER,choices TEXT NOT NULL DEFAULT '[]',pending_prompt TEXT,last_update_id INTEGER NOT NULL DEFAULT -1,
 lease TEXT,lease_until INTEGER
);
