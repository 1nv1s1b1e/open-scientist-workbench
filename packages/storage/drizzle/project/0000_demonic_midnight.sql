CREATE TABLE `critiques` (
	`id` text PRIMARY KEY NOT NULL,
	`hypo_id` text NOT NULL,
	`critique_text` text NOT NULL,
	`rationale` text NOT NULL,
	`round` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`hypo_id` text NOT NULL,
	`fits_paths_json` text NOT NULL,
	`video_clip_path` text,
	`metadata_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `hypotheses` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`run_id` text NOT NULL,
	`parent_id` text,
	`round` integer NOT NULL,
	`statement` text NOT NULL,
	`python_code` text NOT NULL,
	`f1` real,
	`status` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `logs` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text,
	`level` text NOT NULL,
	`message_json` text NOT NULL,
	`timestamp` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`role` text NOT NULL,
	`parts_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mutations` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_hypo_id` text NOT NULL,
	`child_hypo_id` text NOT NULL,
	`mutation_rationale` text NOT NULL,
	`round` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`round` integer NOT NULL,
	`search_params_json` text NOT NULL,
	`mhd_cfg_path` text,
	`proposal_path` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`config_json` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_name_unique` ON `projects` (`name`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`resume_state_blob` text,
	`current_round` integer DEFAULT 0 NOT NULL,
	`best_f1` real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `steering_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`content` text NOT NULL,
	`mode` text NOT NULL,
	`injected_at` text,
	`status` text NOT NULL
);
