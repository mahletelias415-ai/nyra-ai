CREATE TABLE nyra_login_challenges (id TEXT PRIMARY KEY,address TEXT NOT NULL,message TEXT NOT NULL,binding_hash TEXT NOT NULL,origin TEXT NOT NULL,expires_at INTEGER NOT NULL,used_at INTEGER);
--> statement-breakpoint
CREATE INDEX nyra_login_expiry ON nyra_login_challenges(expires_at);
--> statement-breakpoint
CREATE TABLE nyra_sessions (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE INDEX nyra_sessions_user ON nyra_sessions(user_id,expires_at);
--> statement-breakpoint
CREATE TABLE nyra_rate_limits (key TEXT NOT NULL,bucket INTEGER NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(key,bucket));
