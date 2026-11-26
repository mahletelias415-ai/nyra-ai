CREATE TABLE `nyra_briefs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`day` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `nyra_brief_day` ON `nyra_briefs` (`user_id`,`day`);--> statement-breakpoint
CREATE TABLE `nyra_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`address` text,
	`message` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `nyra_challenges_user` ON `nyra_challenges` (`user_id`);--> statement-breakpoint
CREATE TABLE `nyra_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_at` integer NOT NULL,
	`lease` text,
	`lease_until` integer,
	`last_error` text DEFAULT '' NOT NULL,
	`sent_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `nyra_delivery_due` ON `nyra_deliveries` (`status`,`next_at`);--> statement-breakpoint
CREATE TABLE `nyra_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`wallet` text,
	`wallet_verified_at` integer,
	`telegram_chat_id` text,
	`telegram_linked_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `nyra_wallet_unique` ON `nyra_profiles` (`wallet`);--> statement-breakpoint
CREATE TABLE `nyra_readings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`watch_id` text,
	`plan` text NOT NULL,
	`result` text NOT NULL,
	`kind` text NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `nyra_readings_user_time` ON `nyra_readings` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `nyra_runner_state` (
	`id` text PRIMARY KEY NOT NULL,
	`lease` text,
	`lease_until` integer,
	`last_started_at` integer,
	`last_finished_at` integer,
	`last_result` text
);
--> statement-breakpoint
CREATE TABLE `nyra_watches` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`plan` text NOT NULL,
	`previous` text NOT NULL,
	`paused` integer DEFAULT 0 NOT NULL,
	`checks` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`last_at` integer NOT NULL,
	`next_at` integer NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`lease` text,
	`lease_until` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `nyra_watch_fingerprint` ON `nyra_watches` (`user_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `nyra_watch_due` ON `nyra_watches` (`paused`,`next_at`);