ALTER TABLE `runs` ADD `workflow_type` text DEFAULT 'tournament' NOT NULL;--> statement-breakpoint
ALTER TABLE `runs` ADD `scientific_status` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `termination_reason` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `config_json` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `result_json` text;--> statement-breakpoint
ALTER TABLE `validation_tasks` ADD `executor_id` text;--> statement-breakpoint
WITH `duplicate_tasks` AS (
  SELECT
    `id`,
    ROW_NUMBER() OVER (
      PARTITION BY `run_id`, `fingerprint`
      ORDER BY `created_at`, `id`
    ) AS `duplicate_rank`
  FROM `validation_tasks`
)
UPDATE `validation_tasks`
SET `fingerprint` = `fingerprint` || '-legacy-' || `id`
WHERE `id` IN (
  SELECT `id` FROM `duplicate_tasks` WHERE `duplicate_rank` > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX `validation_tasks_run_id_fingerprint_unique`
ON `validation_tasks` (`run_id`, `fingerprint`);--> statement-breakpoint
WITH `ordered_chunks` AS (
  SELECT
    `id`,
    ROW_NUMBER() OVER (PARTITION BY `run_id` ORDER BY `id`) - 1 AS `new_seq`
  FROM `run_chunks`
)
UPDATE `run_chunks`
SET `seq` = (
  SELECT `new_seq`
  FROM `ordered_chunks`
  WHERE `ordered_chunks`.`id` = `run_chunks`.`id`
);--> statement-breakpoint
CREATE UNIQUE INDEX `run_chunks_run_id_seq_unique` ON `run_chunks` (`run_id`, `seq`);
