CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`run_id` text NOT NULL,
	`kind` text NOT NULL,
	`path` text NOT NULL,
	`checksum` text NOT NULL,
	`media_type` text,
	`generated_by` text NOT NULL,
	`processing_run_id` text NOT NULL,
	`source_ids_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `data_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`run_id` text NOT NULL,
	`source_ids_json` text NOT NULL,
	`manifest_path` text NOT NULL,
	`checksums_json` text NOT NULL,
	`selection_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `processing_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`run_id` text NOT NULL,
	`round` integer NOT NULL,
	`agent_id` text NOT NULL,
	`task_id` text,
	`triggered_by` text NOT NULL,
	`snapshot_ids_json` text NOT NULL,
	`steps_json` text NOT NULL,
	`deterministic` integer NOT NULL,
	`status` text NOT NULL,
	`output_artifact_ids_json` text NOT NULL,
	`metrics_artifact_id` text,
	`limitations_json` text NOT NULL,
	`fingerprint` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
ALTER TABLE `memory_entries` ADD `layer` text DEFAULT 'episodic' NOT NULL;--> statement-breakpoint
ALTER TABLE `memory_entries` ADD `namespace_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `memory_entries` ADD `artifact_ids_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `memory_entries` ADD `processing_run_ids_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `memory_entries` ADD `triggered_by_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `memory_entries` ADD `verification_status` text DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE `memory_entries` ADD `agent_id` text;--> statement-breakpoint
ALTER TABLE `memory_entries` ADD `phenomenon_id` text;