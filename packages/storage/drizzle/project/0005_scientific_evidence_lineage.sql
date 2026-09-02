ALTER TABLE `scientific_evidence` ADD `prediction_ids_json` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `scientific_evidence` ADD `falsification_condition_ids_json` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `scientific_evidence` ADD `lineage_json` text;
--> statement-breakpoint
ALTER TABLE `scientific_evidence` ADD `quantitative_results_json` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `validation_tasks` ADD `hypothesis_ids_json` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `validation_tasks` ADD `prediction_ids_json` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `validation_tasks` ADD `falsification_condition_ids_json` text DEFAULT '[]' NOT NULL;
