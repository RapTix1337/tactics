CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`theme` text NOT NULL,
	`cs2_path` text,
	`gsi_port` integer,
	`autostart` integer NOT NULL,
	`close_to_tray` integer NOT NULL,
	`auto_update` integer NOT NULL
);
