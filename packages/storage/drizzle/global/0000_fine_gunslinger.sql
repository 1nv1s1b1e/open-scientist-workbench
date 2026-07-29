CREATE TABLE `credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`type` text NOT NULL,
	`encrypted_key` text NOT NULL,
	`base_url` text,
	`metadata_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mcp_trust` (
	`id` text PRIMARY KEY NOT NULL,
	`project_name` text NOT NULL,
	`server_name` text NOT NULL,
	`fingerprint` text NOT NULL,
	`trusted` integer NOT NULL,
	`first_seen` text NOT NULL,
	`last_checked` text NOT NULL
);
