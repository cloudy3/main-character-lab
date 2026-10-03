import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { TERMINAL } from "@/domain/types";
import { db } from "./db";
import { jobs, references } from "./db/schema";

export function referenceJobs(id: string) {
  const all = db()
    .select()
    .from(jobs)
    .where(eq(jobs.ownerId, id))
    .orderBy(desc(jobs.createdAt), sql`rowid desc`)
    .all();
  return ["pose", "mask"].flatMap((kind) => {
    const latest = all.find((j) => j.kind === kind);
    return latest ? [latest] : [];
  });
}
export function referenceIsBusy(id: string) {
  return referenceJobs(id).some(
    (j) => !TERMINAL.includes(j.status) || j.status === "uncertain",
  );
}
export function syncReferenceState(id: string) {
  const ref = db().select().from(references).where(eq(references.id, id)).get();
  if (!ref) return;
  const latest = referenceJobs(id);
  const failure = latest.find((j) =>
    ["failed", "cancelled", "uncertain"].includes(j.status),
  );
  const manuallyResolved =
    ref.sanitizedAssetId &&
    ref.poseAssetId &&
    ref.maskAssetId &&
    !referenceIsBusy(id);
  const status = manuallyResolved
    ? "ready"
    : failure
      ? "failed"
      : referenceIsBusy(id)
        ? "preparing"
        : ref.poseAssetId && ref.maskAssetId
          ? ref.sanitizedAssetId
            ? "ready"
            : "review"
          : "uploaded";
  db()
    .update(references)
    .set({
      status,
      error: manuallyResolved
        ? null
        : (failure?.error ??
          (failure
            ? "Reference preparation was interrupted. Resolve uncertain requests or explicitly restart the missing steps."
            : null)),
    })
    .where(eq(references.id, id))
    .run();
}
