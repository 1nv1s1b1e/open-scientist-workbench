CREATE TABLE `scientific_hypotheses` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`run_id` text NOT NULL,
	`round` integer NOT NULL,
	`statement` text NOT NULL,
	`mechanism_composition_json` text NOT NULL,
	`predictions_json` text NOT NULL,
	`falsification_conditions_json` text NOT NULL,
	`source_ids_json` text NOT NULL,
	`scope` text NOT NULL,
	`confidence` real NOT NULL,
	`parent_id` text,
	`status` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scientific_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`run_id` text NOT NULL,
	`round` integer NOT NULL,
	`hypothesis_id` text,
	`task_id` text,
	`agent_id` text,
	`status` text NOT NULL,
	`claim` text NOT NULL,
	`observed` text NOT NULL,
	`method` text NOT NULL,
	`source_ids_json` text NOT NULL,
	`sample_ids_json` text NOT NULL,
	`provenance_json` text,
	`metrics_json` text,
	`uncertainty` text,
	`limitations_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scientific_corrections` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`run_id` text NOT NULL,
	`round` integer NOT NULL,
	`stage` text NOT NULL,
	`kind` text NOT NULL,
	`severity` text NOT NULL,
	`message` text NOT NULL,
	`action` text NOT NULL,
	`affected_ids_json` text NOT NULL,
	`triggered_by_json` text NOT NULL,
	`agent_id` text,
	`created_at` text NOT NULL
);
