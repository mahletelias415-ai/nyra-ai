CREATE TABLE nyra_entitlements (
 user_id TEXT PRIMARY KEY NOT NULL,
 ai_credits INTEGER NOT NULL DEFAULT 0 CHECK(ai_credits>=0),
 watch_slots INTEGER NOT NULL DEFAULT 0 CHECK(watch_slots>=0)
);
--> statement-breakpoint
CREATE TABLE nyra_purchases (
 id TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL,
 wallet TEXT NOT NULL,
 sku TEXT NOT NULL,
 token_amount TEXT NOT NULL,
 ai_credits INTEGER NOT NULL,
 watch_slots INTEGER NOT NULL,
 min_block TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'prepared',
 tx_hash TEXT,
 credited_at INTEGER,
 next_check_at INTEGER NOT NULL DEFAULT 0,
 last_error TEXT NOT NULL DEFAULT ''
);
--> statement-breakpoint
CREATE INDEX nyra_purchase_user ON nyra_purchases(user_id,created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX nyra_purchase_open_sku ON nyra_purchases(user_id,sku) WHERE status='prepared';
--> statement-breakpoint
CREATE TABLE nyra_payment_receipts (
 tx_hash TEXT PRIMARY KEY NOT NULL,
 purchase_id TEXT UNIQUE NOT NULL,
 user_id TEXT NOT NULL,
 block_number TEXT NOT NULL,
 block_hash TEXT NOT NULL,
 log_index INTEGER NOT NULL,
 token_amount TEXT NOT NULL,
 verified_at INTEGER NOT NULL
);
--> statement-breakpoint
ALTER TABLE nyra_agent_runs ADD COLUMN billing_type TEXT NOT NULL DEFAULT 'free';
--> statement-breakpoint
ALTER TABLE nyra_agent_runs ADD COLUMN credit_refunded INTEGER NOT NULL DEFAULT 0;
