import {
  sqliteTable,
  text,
  integer,
  real,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type {
  CostEstimate,
  GenerationSnapshot,
  JobKind,
  JobPayload,
  JobStatus,
  ProviderId,
  ProviderResult,
  TrainingSnapshot,
} from "@/domain/types";
export const assets = sqliteTable("assets", {
  id: text("id").primaryKey(),
  path: text("path").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  sha256: text("sha256").notNull(),
  width: integer("width"),
  height: integer("height"),
  purpose: text("purpose").notNull(),
  createdAt: integer("created_at").notNull(),
});
export const identities = sqliteTable("identities", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  trigger: text("trigger").notNull(),
  createdAt: integer("created_at").notNull(),
  deletedAt: integer("deleted_at"),
});
export const photos = sqliteTable("photos", {
  id: text("id").primaryKey(),
  identityId: text("identity_id")
    .notNull()
    .references(() => identities.id),
  assetId: text("asset_id")
    .notNull()
    .references(() => assets.id),
  createdAt: integer("created_at").notNull(),
  removedAt: integer("removed_at"),
});
export const trainings = sqliteTable("trainings", {
  id: text("id").primaryKey(),
  identityId: text("identity_id")
    .notNull()
    .references(() => identities.id),
  provider: text("provider").$type<ProviderId>().notNull(),
  snapshot: text("snapshot", { mode: "json" })
    .$type<TrainingSnapshot>()
    .notNull(),
  loraAssetId: text("lora_asset_id").references(() => assets.id),
  configAssetId: text("config_asset_id").references(() => assets.id),
  estimate: text("estimate", { mode: "json" }).$type<CostEstimate>().notNull(),
  actualCost: real("actual_cost"),
  createdAt: integer("created_at").notNull(),
});
export const references = sqliteTable("reference_assets", {
  id: text("id").primaryKey(),
  assetId: text("asset_id")
    .notNull()
    .references(() => assets.id),
  provider: text("provider").$type<ProviderId>().notNull(),
  status: text("status")
    .$type<"uploaded" | "preparing" | "review" | "ready" | "failed">()
    .notNull(),
  poseAssetId: text("pose_asset_id").references(() => assets.id),
  maskAssetId: text("mask_asset_id").references(() => assets.id),
  sanitizedAssetId: text("sanitized_asset_id").references(() => assets.id),
  error: text("error"),
  createdAt: integer("created_at").notNull(),
});
export const generations = sqliteTable("generations", {
  id: text("id").primaryKey(),
  identityId: text("identity_id")
    .notNull()
    .references(() => identities.id),
  trainingId: text("training_id")
    .notNull()
    .references(() => trainings.id),
  referenceId: text("reference_id")
    .notNull()
    .references(() => references.id),
  provider: text("provider").$type<ProviderId>().notNull(),
  snapshot: text("snapshot", { mode: "json" })
    .$type<GenerationSnapshot>()
    .notNull(),
  estimate: text("estimate", { mode: "json" }).$type<CostEstimate>().notNull(),
  createdAt: integer("created_at").notNull(),
});
export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  kind: text("kind").$type<JobKind>().notNull(),
  provider: text("provider").$type<ProviderId>().notNull(),
  status: text("status").$type<JobStatus>().notNull(),
  payload: text("payload", { mode: "json" }).$type<JobPayload>().notNull(),
  input: text("input", { mode: "json" }).$type<Record<string, unknown>>(),
  endpoint: text("endpoint"),
  requestId: text("request_id"),
  result: text("result", { mode: "json" }).$type<ProviderResult>(),
  error: text("error"),
  message: text("message"),
  leaseUntil: integer("lease_until").notNull().default(0),
  nextPollAt: integer("next_poll_at").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
export const outputs = sqliteTable(
  "outputs",
  {
    id: text("id").primaryKey(),
    generationId: text("generation_id")
      .notNull()
      .references(() => generations.id),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id),
    seed: integer("seed").notNull(),
    actualCost: real("actual_cost"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("outputs_job_unique").on(t.jobId)],
);
export const submissions = sqliteTable("submissions", {
  key: text("key").primaryKey(),
  fingerprint: text("fingerprint").notNull(),
  ownerId: text("owner_id").notNull(),
  createdAt: integer("created_at").notNull(),
});
export type Asset = typeof assets.$inferSelect;
export type Job = typeof jobs.$inferSelect;
