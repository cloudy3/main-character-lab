import type { library, generationView, jobViews } from "@/server/services";
import type { Asset } from "@/server/db/schema";
import type { references } from "@/server/db/schema";
export type IdentityView = ReturnType<typeof library>[number];
export type GenerationView = ReturnType<typeof generationView>;
export type JobView = ReturnType<typeof jobViews>[number];
export type ReferenceView = typeof references.$inferSelect & {
  asset: Asset;
  jobs: JobView[];
};
