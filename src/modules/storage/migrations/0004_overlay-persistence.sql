ALTER TABLE `operational_state` ADD `overlay_bounds` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `overlay_opacity` real DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `overlay_map_exempt` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `overlay_scoreboard_exempt` integer DEFAULT 0 NOT NULL;