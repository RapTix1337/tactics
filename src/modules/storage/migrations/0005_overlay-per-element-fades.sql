ALTER TABLE `settings` ADD `overlay_scoreboard_opacity` real DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `overlay_map_opacity` real DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `overlay_callout_opacity` real DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `overlay_chrome_opacity` real DEFAULT 1 NOT NULL;--> statement-breakpoint
UPDATE `settings` SET
  `overlay_scoreboard_opacity` = CASE WHEN `overlay_scoreboard_exempt` = 1 THEN 1 ELSE `overlay_opacity` END,
  `overlay_map_opacity` = CASE WHEN `overlay_map_exempt` = 1 THEN 1 ELSE `overlay_opacity` END,
  `overlay_callout_opacity` = CASE WHEN `overlay_map_exempt` = 1 THEN 1 ELSE `overlay_opacity` END,
  `overlay_chrome_opacity` = `overlay_opacity`;--> statement-breakpoint
ALTER TABLE `settings` DROP COLUMN `overlay_opacity`;--> statement-breakpoint
ALTER TABLE `settings` DROP COLUMN `overlay_map_exempt`;--> statement-breakpoint
ALTER TABLE `settings` DROP COLUMN `overlay_scoreboard_exempt`;
