CREATE TABLE `credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`type` text NOT NULL,
	`encrypted_key` text NOT NULL,
	`metadata_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mcp_tool_baselines` (
	`id` text PRIMARY KEY NOT NULL,
	`trust_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`digest` text NOT NULL,
	`recorded_at` text NOT NULL
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
--> statement-breakpoint
CREATE TABLE `settings` (
	`scope` text NOT NULL,
	`name` text NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` text NOT NULL
);
