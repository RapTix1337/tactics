CREATE TABLE `map_default_profiles` (
	`map_id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `map_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`map_id` text NOT NULL,
	`name` text NOT NULL,
	`image_file_name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `profile_callouts` (
	`profile_id` text NOT NULL,
	`name` text NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	PRIMARY KEY(`profile_id`, `name`)
);
