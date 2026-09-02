ALTER TABLE `scientific_evidence` ADD `evidence_role` text DEFAULT 'prediction_consistent' NOT NULL;
--> statement-breakpoint
ALTER TABLE `scientific_evidence` ADD `contradiction_scope` text DEFAULT 'mechanism' NOT NULL;
--> statement-breakpoint
ALTER TABLE `scientific_evidence` ADD `adjudication_json` text;
--> statement-breakpoint
ALTER TABLE `scientific_corrections` ADD `evidence_action` text DEFAULT 'none' NOT NULL;
