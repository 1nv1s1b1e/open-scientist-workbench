CREATE TABLE `memory_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`run_id` text NOT NULL,
	`round` integer NOT NULL,
	`kind` text NOT NULL,
	`summary` text NOT NULL,
	`content` text,
	`tags_json` text NOT NULL,
	`source_ids_json` text NOT NULL,
	`hypothesis_ids_json` text NOT NULL,
	`evidence_ids_json` text NOT NULL,
	`task_ids_json` text NOT NULL,
	`fingerprint` text NOT NULL,
	`utility` real DEFAULT 0.5 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `validation_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`run_id` text NOT NULL,
	`route` text NOT NULL,
	`type` text NOT NULL,
	`objective` text NOT NULL,
	`required_source_ids_json` text NOT NULL,
	`discriminating_outcomes_json` text NOT NULL,
	`triggered_by` text NOT NULL,
	`status` text NOT NULL,
	`result_evidence_ids_json` text NOT NULL,
	`round` integer NOT NULL,
	`fingerprint` text NOT NULL,
	`created_at` text NOT NULL
);
