CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`sha256` text NOT NULL,
	`width` integer,
	`height` integer,
	`purpose` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `generations` (
	`id` text PRIMARY KEY NOT NULL,
	`identity_id` text NOT NULL,
	`training_id` text NOT NULL,
	`reference_id` text NOT NULL,
	`provider` text NOT NULL,
	`snapshot` text NOT NULL,
	`estimate` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`identity_id`) REFERENCES `identities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`training_id`) REFERENCES `trainings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reference_id`) REFERENCES `reference_assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `identities` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`trigger` text NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`provider` text NOT NULL,
	`status` text NOT NULL,
	`payload` text NOT NULL,
	`input` text,
	`endpoint` text,
	`request_id` text,
	`result` text,
	`error` text,
	`message` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`next_poll_at` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `outputs` (
	`id` text PRIMARY KEY NOT NULL,
	`generation_id` text NOT NULL,
	`job_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`seed` integer NOT NULL,
	`actual_cost` real,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`generation_id`) REFERENCES `generations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outputs_job_unique` ON `outputs` (`job_id`);--> statement-breakpoint
CREATE TABLE `photos` (
	`id` text PRIMARY KEY NOT NULL,
	`identity_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`identity_id`) REFERENCES `identities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `reference_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`provider` text NOT NULL,
	`status` text NOT NULL,
	`pose_asset_id` text,
	`mask_asset_id` text,
	`sanitized_asset_id` text,
	`error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pose_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`mask_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sanitized_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `submissions` (
	`key` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trainings` (
	`id` text PRIMARY KEY NOT NULL,
	`identity_id` text NOT NULL,
	`provider` text NOT NULL,
	`snapshot` text NOT NULL,
	`lora_asset_id` text,
	`config_asset_id` text,
	`estimate` text NOT NULL,
	`actual_cost` real,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`identity_id`) REFERENCES `identities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lora_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`config_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action
);
