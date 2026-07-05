CREATE TABLE `operational_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`gsi_token` text NOT NULL,
	`effective_gsi_port` integer,
	`window_x` integer,
	`window_y` integer,
	`window_width` integer,
	`window_height` integer,
	`window_maximized` integer
);
