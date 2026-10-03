import "server-only";
import { and, eq, lte, notInArray } from "drizzle-orm";
import { zipSync } from "fflate";
import sharp from "sharp";
import { db } from "./db";
import {
  jobs,
  trainings,
  references,
  generations,
  outputs,
  type Job,
} from "./db/schema";
import { TERMINAL, type ProviderId } from "@/domain/types";
import { provider } from "./providers";
import { getAsset, readAsset, saveProviderImage, storeAsset } from "./storage";
import { expandedMask, transformedAsset } from "./images";
import { AppError, logError, ProviderError, safeError } from "./errors";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { referenceJobs, syncReferenceState } from "./reference-state";
const LEASE_MS = 10 * 60_000;
function update(id: string, values: Partial<typeof jobs.$inferInsert>) {
  db()
    .update(jobs)
    .set({ ...values, updatedAt: Date.now() })
    .where(eq(jobs.id, id))
    .run();
}
// In-memory cache is only an optimization; local files remain the source of truth.
const remoteCache = new Map<string, { url: string; until: number }>();
async function uploadAsset(id: string, providerId: ProviderId) {
  const key = `${providerId}:${id}`;
  const cached = remoteCache.get(key);
  if (cached && cached.until > Date.now()) return cached.url;
  const a = getAsset(id);
  const url = await provider(providerId).upload(
    await readAsset(id),
    `${id}${path.extname(a.path)}`,
    a.mime,
  );
  remoteCache.set(key, { url, until: Date.now() + 30 * 60_000 });
  return url;
}
export async function prepareInput(job: Job): Promise<Record<string, unknown>> {
  const p = provider(job.provider);
  const payload = job.payload;
  if (payload.kind === "training") {
    const training = db()
      .select()
      .from(trainings)
      .where(eq(trainings.id, payload.trainingId))
      .get()!;
    const files: Record<string, Uint8Array> = {};
    for (const [index, item] of training.snapshot.dataset.entries())
      files[`photo_${String(index).padStart(3, "0")}.jpg`] = await readAsset(
        item.assetId,
      );
    const bundle = Buffer.from(zipSync(files, { level: 0 }));
    const url = await p.upload(bundle, `${training.id}.zip`, "application/zip");
    return p.buildInput({
      kind: "training",
      archiveUrl: url,
      trigger: training.snapshot.trigger,
      steps: training.snapshot.steps,
    });
  }
  if (payload.kind === "pose" || payload.kind === "mask")
    return p.buildInput({
      kind: payload.kind,
      imageUrl: await uploadAsset(payload.assetId, job.provider),
    });
  const g = db()
    .select()
    .from(generations)
    .where(eq(generations.id, payload.generationId))
    .get()!;
  const t = db()
    .select()
    .from(trainings)
    .where(eq(trainings.id, g.trainingId))
    .get()!;
  const c = g.snapshot.controls;
  const source = await transformedAsset(
    g.snapshot.sanitizedAssetId,
    c.width,
    c.height,
    "generation-condition",
  );
  const pose = await transformedAsset(
    g.snapshot.poseAssetId,
    c.width,
    c.height,
    "generation-pose",
  );
  const [imageUrl, poseUrl, loraUrl] = await Promise.all([
    uploadAsset(source.id, job.provider),
    uploadAsset(pose.id, job.provider),
    uploadAsset(t.loraAssetId!, job.provider),
  ]);
  return p.buildInput({
    kind: "generation",
    prompt: g.snapshot.effectivePrompt,
    imageUrl,
    poseUrl,
    loraUrl,
    controls: c,
    seed: payload.seed,
  });
}
async function saveResult(job: Job) {
  const result = job.result!;
  const p = provider(job.provider);
  const payload = job.payload;
  if (result.blocked)
    throw new ProviderError(
      "The provider safety checker withheld this image. Change the reference or prompt before submitting a new generation.",
      true,
    );
  if (payload.kind === "training") {
    if (!result.lora || !result.config)
      throw new ProviderError(
        "Training completed without LoRA weights or configuration.",
        true,
      );
    const t = db()
      .select()
      .from(trainings)
      .where(eq(trainings.id, payload.trainingId))
      .get()!;
    if (!t.loraAssetId) {
      const weights = await p.download(result.lora.url, 1024 * 1024 * 1024);
      if (job.provider === "fal") {
        if (weights.length < 10)
          throw new ProviderError("Invalid LoRA artifact.", true);
        const headerLength = Number(weights.readBigUInt64LE());
        if (
          headerLength < 2 ||
          headerLength > Math.min(weights.length - 8, 20_000_000)
        )
          throw new ProviderError("Invalid safetensors header.", true);
        try {
          JSON.parse(weights.subarray(8, 8 + headerLength).toString());
        } catch {
          throw new ProviderError("Invalid safetensors metadata.", true);
        }
      }
      const a = await storeAsset(weights, "application/octet-stream", "lora");
      db()
        .update(trainings)
        .set({ loraAssetId: a.id })
        .where(eq(trainings.id, t.id))
        .run();
    }
    if (!t.configAssetId) {
      const config = await p.download(result.config.url, 10 * 1024 * 1024);
      const a = await storeAsset(config, "application/json", "training-config");
      db()
        .update(trainings)
        .set({ configAssetId: a.id, actualCost: result.actualCost ?? null })
        .where(eq(trainings.id, t.id))
        .run();
    }
    return;
  }
  if (!result.images?.length)
    throw new ProviderError("The provider returned no image.", true);
  if (
    payload.kind === "generation" &&
    db().select().from(outputs).where(eq(outputs.jobId, job.id)).get()
  )
    return;
  const bytes = await p.download(result.images[0].url, 40 * 1024 * 1024);
  if (payload.kind === "pose") {
    const stats = await sharp(bytes, { limitInputPixels: 20_000_000 })
      .removeAlpha()
      .stats();
    if (stats.channels.every((channel) => channel.max < 20))
      throw new ProviderError(
        "No usable body pose was detected. Try a reference with a more visible body.",
        true,
      );
  }
  if (payload.kind === "pose" || payload.kind === "mask") {
    const ref = db()
      .select()
      .from(references)
      .where(eq(references.id, payload.referenceId))
      .get()!;
    const source = getAsset(ref.assetId);
    const data =
      payload.kind === "mask"
        ? await expandedMask(bytes, source.width!, source.height!)
        : bytes;
    const a = await saveProviderImage(data, payload.kind);
    db()
      .update(references)
      .set(
        payload.kind === "mask" ? { maskAssetId: a.id } : { poseAssetId: a.id },
      )
      .where(eq(references.id, ref.id))
      .run();
    const refreshed = db()
      .select()
      .from(references)
      .where(eq(references.id, ref.id))
      .get()!;
    if (refreshed.poseAssetId && refreshed.maskAssetId)
      db()
        .update(references)
        .set({ status: "review", error: null })
        .where(eq(references.id, ref.id))
        .run();
    return;
  }
  const image = await saveProviderImage(bytes, "generated");
  db()
    .insert(outputs)
    .values({
      id: randomUUID(),
      generationId: payload.generationId,
      jobId: job.id,
      assetId: image.id,
      seed: result.seed ?? payload.seed,
      actualCost: result.actualCost ?? null,
      createdAt: Date.now(),
    })
    .onConflictDoNothing()
    .run();
}
export async function processJob(id: string) {
  const acquired = db()
    .update(jobs)
    .set({ leaseUntil: Date.now() + LEASE_MS })
    .where(
      and(
        eq(jobs.id, id),
        lte(jobs.leaseUntil, Date.now()),
        notInArray(jobs.status, TERMINAL),
      ),
    )
    .returning()
    .get();
  if (!acquired) return;
  let job = acquired;
  try {
    const p = provider(job.provider);
    if (job.status === "submitting") {
      update(id, {
        status: "uncertain",
        error:
          "The app stopped during submission. Check fal request history and attach the request ID; do not submit again until you know whether it was billed.",
      });
      return;
    }
    if (job.status === "pending" || job.status === "preparing") {
      update(id, {
        status: "preparing",
        message: "Preparing and uploading required assets",
        error: null,
      });
      const input = await prepareInput(job);
      update(id, {
        input,
        status: "submitting",
        message: "Submitting to provider",
      });
      job = { ...job, status: "submitting", input };
      const submitted = await p.submit(job.kind, input);
      update(id, {
        ...submitted,
        status: "queued",
        attempts: 0,
        nextPollAt: Date.now() + 1500,
        message: "Waiting for provider",
      });
      return;
    }
    if (job.status === "queued" || job.status === "running") {
      const status = await p.status(job.endpoint!, job.requestId!);
      if (status.state !== "completed") {
        update(id, {
          status: status.state,
          error: null,
          attempts: 0,
          message:
            status.state === "queued"
              ? "Waiting for provider"
              : "Provider is processing",
          nextPollAt: Date.now() + 3000,
        });
        return;
      }
      const result = await p.result(job.kind, job.endpoint!, job.requestId!);
      update(id, {
        result,
        status: "saving",
        error: null,
        message: "Saving artifacts locally",
        attempts: 0,
      });
      job = { ...job, status: "saving", result };
    }
    if (job.status === "saving") {
      await saveResult(job);
      update(id, {
        status: "completed",
        message: "Saved locally",
        error: null,
      });
    }
  } catch (e) {
    logError("job_failed", e, id);
    const attempts = job.attempts + 1;
    const definitive = e instanceof ProviderError && e.definitive;
    const uncertain = job.status === "submitting" && !definitive;
    const retryable =
      !uncertain &&
      !definitive &&
      ["queued", "running", "saving"].includes(job.status) &&
      attempts < 6;
    const status = uncertain ? "uncertain" : retryable ? job.status : "failed";
    update(id, {
      status,
      attempts,
      error: safeError(e),
      nextPollAt: Date.now() + Math.min(60_000, 2000 * 2 ** attempts),
    });
    if (!retryable && (job.kind === "pose" || job.kind === "mask"))
      db()
        .update(references)
        .set({ status: "failed", error: safeError(e) })
        .where(eq(references.id, job.ownerId))
        .run();
  } finally {
    update(id, { leaseUntil: 0 });
    if (job.kind === "pose" || job.kind === "mask")
      syncReferenceState(job.ownerId);
  }
}
const globalRunner = globalThis as unknown as {
  mclTick?: boolean;
  mclTimer?: ReturnType<typeof setInterval>;
};
export async function reconcile() {
  if (globalRunner.mclTick) return;
  globalRunner.mclTick = true;
  try {
    const due = db()
      .select()
      .from(jobs)
      .where(
        and(
          notInArray(jobs.status, TERMINAL),
          lte(jobs.nextPollAt, Date.now()),
          lte(jobs.leaseUntil, Date.now()),
        ),
      )
      .orderBy(jobs.createdAt)
      .limit(4)
      .all();
    // Sequential jobs avoid multiple simultaneous LoRA uploads and reduce local memory use.
    for (const j of due) await processJob(j.id);
  } finally {
    globalRunner.mclTick = false;
  }
}
export function startReconciler() {
  if (globalRunner.mclTimer) return;
  globalRunner.mclTimer = setInterval(() => {
    void reconcile().catch((e) => logError("reconcile_failed", e));
  }, 2500);
  globalRunner.mclTimer.unref();
}
export async function jobAction(
  id: string,
  action: "retry" | "attach" | "cancel" | "abandon",
  requestId?: string,
) {
  const job = db().select().from(jobs).where(eq(jobs.id, id)).get();
  if (!job) throw new AppError("Job not found.", 404);
  if (job.leaseUntil > Date.now())
    throw new AppError(
      "This job is currently being processed. Try again shortly.",
      409,
    );
  const isReference = job.kind === "pose" || job.kind === "mask";
  if (
    isReference &&
    db().select().from(references).where(eq(references.id, job.ownerId)).get()
      ?.status === "ready"
  )
    throw new AppError("This reference is already prepared and approved.", 409);
  if (isReference && !referenceJobs(job.ownerId).some((j) => j.id === id))
    throw new AppError(
      "This preparation attempt was superseded. Use its latest attempt.",
      409,
    );
  const claimed = db()
    .update(jobs)
    .set({ leaseUntil: Date.now() + LEASE_MS })
    .where(and(eq(jobs.id, id), lte(jobs.leaseUntil, Date.now())))
    .returning()
    .get();
  if (!claimed)
    throw new AppError("This job is being processed. Try again shortly.", 409);
  try {
    if (action === "attach") {
      if (
        job.status !== "uncertain" ||
        !requestId ||
        !/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)
      )
        throw new AppError("Provide a valid request ID for the uncertain job.");
      const p = provider(job.provider);
      const endpoint =
        job.kind === "training"
          ? p.capabilities.trainingModel
          : job.kind === "generation"
            ? p.capabilities.generationModel
            : p.capabilities.poseModel;
      update(id, {
        requestId,
        endpoint,
        status: "queued",
        nextPollAt: 0,
        error: null,
      });
    } else if (action === "retry") {
      if (job.status !== "failed")
        throw new AppError("Only failed jobs can be retried.");
      update(id, {
        status: job.result ? "saving" : job.requestId ? "queued" : "pending",
        attempts: 0,
        nextPollAt: 0,
        error: null,
      });
    } else if (action === "abandon") {
      if (job.status !== "uncertain")
        throw new AppError("Only an uncertain submission can be abandoned.");
      update(id, {
        status: "cancelled",
        message:
          "Abandoned locally after user checked provider history. Remote work may still be billed.",
      });
    } else {
      if (TERMINAL.includes(job.status))
        throw new AppError("This job is already finished.");
      if (job.requestId && job.endpoint)
        await provider(job.provider).cancel(job.endpoint, job.requestId);
      update(id, {
        status: "cancelled",
        message:
          "Cancellation requested. Work already started may still be billed.",
      });
    }
  } finally {
    update(id, { leaseUntil: 0 });
    if (isReference) syncReferenceState(job.ownerId);
  }
}
