CREATE UNIQUE INDEX IF NOT EXISTS nyra_telegram_chat_unique ON nyra_profiles(telegram_chat_id) WHERE telegram_chat_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS nyra_telegram_updates (
  id integer PRIMARY KEY NOT NULL,
  chat_id text NOT NULL,
  status text NOT NULL DEFAULT 'processing',
  reply text,
  lease text,
  lease_until integer,
  next_at integer NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  last_error text NOT NULL DEFAULT '',
  created_at integer NOT NULL,
  finished_at integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS nyra_telegram_reply_due ON nyra_telegram_updates(status,next_at);
