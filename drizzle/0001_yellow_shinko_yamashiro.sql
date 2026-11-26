CREATE TABLE `nyra_agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`prompt` text NOT NULL,
	`model` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`answer` text DEFAULT '' NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`steps` text DEFAULT '[]' NOT NULL,
	`sources` text DEFAULT '[]' NOT NULL,
	`usage` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `nyra_agent_user_time` ON `nyra_agent_runs` (`user_id`,`created_at`);