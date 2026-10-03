import "server-only";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import {
  assets,
  generations,
  identities,
  jobs,
  outputs,
  photos,
  references,
  submissions,
  trainings,
} from "./db/schema";
import { TERMINAL, type JobPayload } from "@/domain/types";
import {
  buildPrompt,
  controlsSchema,
  resolveControls,
  seedSchema,
  seedsForBatch,
} from "@/domain/controls";
import { AppError } from "./errors";
import { getAsset, removeAsset, storePhoto } from "./storage";
import { configuredProvider, provider } from "./providers";
import { sanitizeReference } from "./images";
import { referenceIsBusy, referenceJobs } from "./reference-state";
export function getIdentity(id: string) {
  const row = db()
    .select()
    .from(identities)
    .where(and(eq(identities.id, id), isNull(identities.deletedAt)))
    .get();
  if (!row) throw new AppError("Identity not found.", 404);
  return row;
}
export function getReference(id: string) {
  const r = db().select().from(references).where(eq(references.id, id)).get();
  if (!r) throw new AppError("Reference not found.", 404);
  return r;
}
export function createIdentity(name: unknown) {
  const parsed = z.string().trim().min(1).max(80).parse(name);
  const id = randomUUID();
  const row = {
    id,
    name: parsed,
    trigger: `mcl${id.replaceAll("-", "").slice(0, 12)}`,
    createdAt: Date.now(),
  };
  db().insert(identities).values(row).run();
  return row;
}
export async function addPhoto(identityId: string, file: File) {
  getIdentity(identityId);
  const existing = db()
    .select()
    .from(photos)
    .where(and(eq(photos.identityId, identityId), isNull(photos.removedAt)))
    .all();
  if (existing.length >= 40)
    throw new AppError("Keep at most 40 photos per identity.");
  const asset = await storePhoto(file, "identity-photo");
  if (existing.some((p) => getAsset(p.assetId).sha256 === asset.sha256)) {
    await removeAsset(asset.id);
    throw new AppError("This photo is already in the dataset.");
  }
  const row = {
    id: randomUUID(),
    identityId,
    assetId: asset.id,
    createdAt: Date.now(),
  };
  db().insert(photos).values(row).run();
  return { ...row, asset };
}
export function removePhoto(identityId: string, photoId: string) {
  getIdentity(identityId);
  // Training snapshots retain their files, even when a photo is removed from the editable dataset.
  db()
    .update(photos)
    .set({ removedAt: Date.now() })
    .where(and(eq(photos.id, photoId), eq(photos.identityId, identityId)))
    .run();
}
function addJob(ownerId: string, payload: JobPayload) {
  const now = Date.now();
  const p = configuredProvider();
  const row = {
    id: randomUUID(),
    ownerId,
    payload,
    kind: payload.kind,
    provider: p,
    status: "pending" as const,
    createdAt: now,
    updatedAt: now,
  };
  db().insert(jobs).values(row).run();
  return row;
}
function idempotent(key: string, input: unknown, action: () => string) {
  z.string().uuid().parse(key);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
  return db().transaction(() => {
    const previous = db()
      .select()
      .from(submissions)
      .where(eq(submissions.key, key))
      .get();
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new AppError(
          "This request key was already used with different parameters.",
          409,
        );
      return previous.ownerId;
    }
    const ownerId = action();
    db()
      .insert(submissions)
      .values({ key, fingerprint, ownerId, createdAt: Date.now() })
      .run();
    return ownerId;
  });
}
export function startTraining(identityId: string, raw: unknown, key: string) {
  const input = z
    .object({
      steps: z.number().int().min(500).max(3000).default(1000),
      confirmCost: z.literal(true),
    })
    .strict()
    .parse(raw);
  return idempotent(key, { action: "training", identityId, input }, () => {
    const identity = getIdentity(identityId);
    const p = provider();
    p.assertConfigured();
    const selected = db()
      .select()
      .from(photos)
      .where(and(eq(photos.identityId, identityId), isNull(photos.removedAt)))
      .all();
    if (selected.length < 10)
      throw new AppError(
        "Add at least 10 distinct photos; 15–30 varied photos are recommended.",
      );
    const active = db()
      .select()
      .from(trainings)
      .where(eq(trainings.identityId, identityId))
      .all()
      .some((t) =>
        db()
          .select()
          .from(jobs)
          .where(eq(jobs.ownerId, t.id))
          .all()
          .some(
            (j) => !TERMINAL.includes(j.status) || j.status === "uncertain",
          ),
      );
    if (active)
      throw new AppError("An identity training is already in progress.", 409);
    const id = randomUUID();
    db()
      .insert(trainings)
      .values({
        id,
        identityId,
        provider: p.capabilities.id,
        createdAt: Date.now(),
        estimate: p.estimateTraining(input.steps),
        snapshot: {
          identityName: identity.name,
          trigger: identity.trigger,
          steps: input.steps,
          baseModel: "flux-1-dev",
          dataset: selected.map((photo) => ({
            assetId: photo.assetId,
            sha256: getAsset(photo.assetId).sha256,
          })),
          trainer: p.capabilities.trainingModel,
          captioning: "provider-auto",
          createMasks: true,
        },
      })
      .run();
    addJob(id, { kind: "training", trainingId: id });
    return id;
  });
}
export async function uploadReference(file: File) {
  const asset = await storePhoto(file, "reference");
  if (asset.width! / asset.height! < 0.25 || asset.width! / asset.height! > 4) {
    await removeAsset(asset.id);
    throw new AppError("Use a reference between 1:4 and 4:1 aspect ratio.");
  }
  const previous = db()
    .select({ ref: references })
    .from(references)
    .innerJoin(assets, eq(references.assetId, assets.id))
    .where(
      and(
        eq(assets.sha256, asset.sha256),
        eq(references.provider, configuredProvider()),
      ),
    )
    .get();
  if (previous) {
    await removeAsset(asset.id);
    return previous.ref;
  }
  const row = {
    id: randomUUID(),
    assetId: asset.id,
    provider: configuredProvider(),
    status: "uploaded" as const,
    createdAt: Date.now(),
  };
  db().insert(references).values(row).run();
  return row;
}
export function prepareReference(id: string, key: string) {
  return idempotent(key, { action: "prepare", id }, () => {
    const r = getReference(id);
    if (r.provider !== configuredProvider())
      throw new AppError(
        "Upload this reference again for the selected provider.",
        409,
      );
    provider(r.provider).assertConfigured();
    if (r.status === "ready" || r.status === "review") return r.id;
    if (referenceIsBusy(id))
      throw new AppError(
        "Wait for active preparation steps and resolve uncertain requests before restarting.",
        409,
      );
    db()
      .update(references)
      .set({ status: "preparing", error: null })
      .where(eq(references.id, id))
      .run();
    if (!r.poseAssetId)
      addJob(id, { kind: "pose", referenceId: id, assetId: r.assetId });
    if (!r.maskAssetId)
      addJob(id, { kind: "mask", referenceId: id, assetId: r.assetId });
    return id;
  });
}
export async function approveMask(id: string, bytes: Buffer) {
  const r = getReference(id);
  if (referenceIsBusy(id))
    throw new AppError(
      "Wait for reference preparation to finish before saving a corrected mask.",
      409,
    );
  if (!r.poseAssetId)
    throw new AppError(
      "Wait for pose preparation before approving the face mask.",
      409,
    );
  const output = await sanitizeReference(r.assetId, bytes);
  db()
    .update(references)
    .set({
      status: "ready",
      maskAssetId: output.mask.id,
      sanitizedAssetId: output.sanitized.id,
      error: null,
    })
    .where(eq(references.id, id))
    .run();
}
const generationInput = z
  .object({
    trainingId: z.string().uuid(),
    referenceId: z.string().uuid(),
    sourceGenerationId: z.string().uuid().optional(),
    prompt: z.string().max(3000).default(""),
    controls: controlsSchema,
    count: z.number().int().min(1).max(4).default(1),
    seed: seedSchema.optional(),
  })
  .strict();
export function startGeneration(raw: unknown, key: string) {
  const input = generationInput.parse(raw);
  return idempotent(key, { action: "generation", input }, () => {
    const training = db()
      .select()
      .from(trainings)
      .where(eq(trainings.id, input.trainingId))
      .get();
    if (!training?.loraAssetId)
      throw new AppError("Select a completed identity training.");
    if (
      !db()
        .select()
        .from(jobs)
        .where(and(eq(jobs.ownerId, training.id), eq(jobs.status, "completed")))
        .get()
    )
      throw new AppError("Wait for the identity artifacts to finish saving.");
    const identity = getIdentity(training.identityId);
    const p = provider(training.provider);
    p.assertConfigured();
    if (
      training.provider !== configuredProvider() ||
      training.snapshot.baseModel !== p.capabilities.baseModel
    )
      throw new AppError(
        "This LoRA is not compatible with the selected provider and model.",
        409,
      );
    const ref = getReference(input.referenceId);
    if (
      ref.status !== "ready" ||
      !ref.sanitizedAssetId ||
      !ref.poseAssetId ||
      !ref.maskAssetId
    )
      throw new AppError(
        "Prepare the reference and approve its face mask first.",
      );
    if (ref.provider !== training.provider)
      throw new AppError("Reference and identity must use the same provider.");
    const original = input.sourceGenerationId
      ? db()
          .select()
          .from(generations)
          .where(eq(generations.id, input.sourceGenerationId))
          .get()
      : undefined;
    if (
      input.sourceGenerationId &&
      (!original ||
        original.trainingId !== training.id ||
        original.referenceId !== ref.id)
    )
      throw new AppError(
        "The saved generation does not match this identity and reference.",
      );
    const source = getAsset(ref.assetId);
    const controls =
      original?.snapshot.controls ??
      resolveControls(input.controls, source.width!, source.height!);
    const seeds = seedsForBatch(
      input.seed ?? randomInt(0, 2147483648),
      input.count,
    );
    const id = randomUUID();
    db()
      .insert(generations)
      .values({
        id,
        identityId: identity.id,
        trainingId: training.id,
        referenceId: ref.id,
        provider: training.provider,
        createdAt: Date.now(),
        estimate: p.estimateGeneration(
          controls.width,
          controls.height,
          input.count,
        ),
        snapshot: {
          identityName: identity.name,
          trigger: identity.trigger,
          trainingId: training.id,
          loraHash: getAsset(training.loraAssetId).sha256,
          referenceId: ref.id,
          referenceAssetId: ref.assetId,
          maskAssetId: ref.maskAssetId,
          sanitizedAssetId: ref.sanitizedAssetId,
          poseAssetId: ref.poseAssetId,
          prompt: input.prompt,
          effectivePrompt: buildPrompt(identity.trigger, input.prompt),
          controls,
          seeds,
          model: p.capabilities.generationModel,
          baseModel: "flux-1-dev",
        },
      })
      .run();
    if (original)
      db()
        .update(generations)
        .set({ snapshot: { ...original.snapshot, seeds } })
        .where(eq(generations.id, id))
        .run();
    seeds.forEach((seed, index) =>
      addJob(id, { kind: "generation", generationId: id, seed, index }),
    );
    return id;
  });
}
export async function deleteIdentity(id: string) {
  getIdentity(id);
  const runs = db()
    .select()
    .from(trainings)
    .where(eq(trainings.identityId, id))
    .all();
  const gens = db()
    .select()
    .from(generations)
    .where(eq(generations.identityId, id))
    .all();
  const owners = [...runs, ...gens].map((x) => x.id);
  if (
    owners.length &&
    db()
      .select()
      .from(jobs)
      .where(inArray(jobs.ownerId, owners))
      .all()
      .some((j) => !TERMINAL.includes(j.status) || j.status === "uncertain")
  )
    throw new AppError(
      "Resolve active or uncertain jobs before deleting this identity.",
      409,
    );
  const ids = new Set(
    db()
      .select()
      .from(photos)
      .where(eq(photos.identityId, id))
      .all()
      .map((p) => p.assetId),
  );
  for (const t of runs) {
    t.snapshot.dataset.forEach((p) => ids.add(p.assetId));
    if (t.loraAssetId) ids.add(t.loraAssetId);
    if (t.configAssetId) ids.add(t.configAssetId);
  }
  for (const assetId of ids) await removeAsset(assetId);
  db()
    .update(identities)
    .set({ deletedAt: Date.now() })
    .where(eq(identities.id, id))
    .run();
}
export function library() {
  const identityRows = db()
    .select()
    .from(identities)
    .where(isNull(identities.deletedAt))
    .orderBy(desc(identities.createdAt))
    .all();
  return identityRows.map((i) => ({
    ...i,
    photos: db()
      .select()
      .from(photos)
      .where(and(eq(photos.identityId, i.id), isNull(photos.removedAt)))
      .all()
      .map((p) => ({ ...p, asset: getAsset(p.assetId) })),
    trainings: db()
      .select()
      .from(trainings)
      .where(eq(trainings.identityId, i.id))
      .orderBy(desc(trainings.createdAt))
      .all()
      .map((t) => ({ ...t, job: jobViews(t.id)[0] })),
  }));
}
export function jobViews(ownerId: string) {
  return db()
    .select()
    .from(jobs)
    .where(eq(jobs.ownerId, ownerId))
    .orderBy(jobs.createdAt)
    .all()
    .map((j) => ({
      id: j.id,
      kind: j.kind,
      status: j.status,
      requestId: j.requestId,
      endpoint: j.endpoint,
      error: j.error,
      message: j.message,
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
      actualCost: j.result?.actualCost ?? null,
    }));
}
export function referenceJobViews(id: string) {
  const latestIds = new Set(referenceJobs(id).map((j) => j.id));
  return jobViews(id).filter((j) => latestIds.has(j.id));
}
export function generationView(id: string) {
  const g = db().select().from(generations).where(eq(generations.id, id)).get();
  if (!g) throw new AppError("Generation not found.", 404);
  return {
    ...g,
    jobs: jobViews(id),
    outputs: db()
      .select()
      .from(outputs)
      .where(eq(outputs.generationId, id))
      .orderBy(outputs.createdAt)
      .all(),
  };
}
export function history(identityId?: string, before?: number) {
  const rows = db()
    .select()
    .from(generations)
    .where(
      and(
        identityId ? eq(generations.identityId, identityId) : undefined,
        before ? lt(generations.createdAt, before) : undefined,
      ),
    )
    .orderBy(desc(generations.createdAt))
    .limit(40)
    .all();
  return rows.map((g) => generationView(g.id));
}
