ALTER TABLE `scientific_hypotheses` ADD `priority` text;
--> statement-breakpoint
ALTER TABLE `scientific_hypotheses` ADD `priority_reason` text;
--> statement-breakpoint
ALTER TABLE `scientific_hypotheses` ADD `confidence_basis_json` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `validation_tasks` ADD `required_data_json` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `validation_tasks` ADD `required_facilities_json` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `validation_tasks` ADD `readiness` text;
--> statement-breakpoint
ALTER TABLE `validation_tasks` ADD `expected_duration` text;
--> statement-breakpoint
ALTER TABLE `validation_tasks` ADD `estimated_storage_bytes` integer;
--> statement-breakpoint
ALTER TABLE `validation_tasks` ADD `success_criteria_json` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `validation_tasks` ADD `failure_criteria_json` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `validation_tasks` ADD `blocked_reason` text;
