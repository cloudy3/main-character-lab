import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { DEFAULT_CONTROLS } from "@/domain/controls";
let directory: string;
let services: typeof import("@/server/services");
let store: typeof import("@/server/storage");
let database: typeof import("@/server/db");
let tables: typeof import("@/server/db/schema");
let runner: typeof import("@/server/jobs");
let identityId: string,
  trainingId: string,
  referenceId: string,
  generationId: string;
async function photo(n: number) {
  const bytes = await sharp({
    create: {
      width: 320,
      height: 400,
      channels: 3,
      background: { r: 30 + n * 13, g: 75, b: 90 },
    },
  })
    .jpeg()
    .toBuffer();
  return new File([new Uint8Array(bytes)], `photo-${n}.jpg`, {
    type: "image/jpeg",
  });
}
async function finishOwner(id: string) {
  const js = database
    .db()
    .select()
    .from(tables.jobs)
    .where(eq(tables.jobs.ownerId, id))
    .all();
  for (const job of js) {
    await runner.processJob(job.id);
    await runner.processJob(job.id);
  }
}
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "mcl-integration-"));
  process.env.DATA_DIR = directory;
  process.env.AI_PROVIDER = "mock";
  services = await import("@/server/services");
  store = await import("@/server/storage");
  database = await import("@/server/db");
  tables = await import("@/server/db/schema");
  runner = await import("@/server/jobs");
});
afterAll(async () => {
  vi.restoreAllMocks();
  database?.db().$client.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});
describe("durable local photography workflow", () => {
  it("validates images, dataset size and exact duplicates", async () => {
    identityId = services.createIdentity("Test identity").id;
    await expect(
      store.normalizeImage(Buffer.from("not an image")),
    ).rejects.toThrow("corrupt");
    expect(() =>
      services.startTraining(identityId, { confirmCost: true }, randomUUID()),
    ).toThrow("at least 10");
    for (let n = 0; n < 10; n++)
      await services.addPhoto(identityId, await photo(n));
    await expect(services.addPhoto(identityId, await photo(0))).rejects.toThrow(
      "already",
    );
  });
  it("submits once per key, persists training inputs and saves reusable weights", async () => {
    const key = randomUUID();
    trainingId = services.startTraining(
      identityId,
      { steps: 1000, confirmCost: true },
      key,
    );
    expect(
      services.startTraining(
        identityId,
        { steps: 1000, confirmCost: true },
        key,
      ),
    ).toBe(trainingId);
    expect(() =>
      services.startTraining(
        identityId,
        { steps: 1500, confirmCost: true },
        key,
      ),
    ).toThrow("different parameters");
    await finishOwner(trainingId);
    const t = services.library()[0].trainings[0];
    expect(t.job.status).toBe("completed");
    expect(t.loraAssetId).toBeTruthy();
    expect((await store.readAsset(t.loraAssetId!)).length).toBeGreaterThan(0);
    expect(t.snapshot.dataset).toHaveLength(10);
  });
  it("prepares reference, refuses an empty mask and strips selected pixels", async () => {
    const ref = await services.uploadReference(await photo(12));
    referenceId = ref.id;
    const key = randomUUID();
    services.prepareReference(referenceId, key);
    services.prepareReference(referenceId, key);
    expect(services.jobViews(referenceId)).toHaveLength(2);
    await finishOwner(referenceId);
    expect(services.getReference(referenceId).status).toBe("review");
    const empty = await sharp({
      create: { width: 320, height: 400, channels: 3, background: "black" },
    })
      .png()
      .toBuffer();
    await expect(services.approveMask(referenceId, empty)).rejects.toThrow(
      "Paint over",
    );
    await services.approveMask(
      referenceId,
      await sharp(
        await store.readAsset(services.getReference(referenceId).maskAssetId!),
      )
        .ensureAlpha()
        .png()
        .toBuffer(),
    );
    const ready = services.getReference(referenceId);
    expect(ready.status).toBe("ready");
    const raw = await sharp(await store.readAsset(ready.sanitizedAssetId!))
      .raw()
      .toBuffer({ resolveWithObject: true });
    const at = (Math.round(400 * 0.28) * 320 + 160) * raw.info.channels;
    expect([...raw.data.subarray(at, at + 3)]).toEqual([127, 127, 127]);
  });
  it("recovers cancelled reference preparation without repeating successful steps", async () => {
    const ref = await services.uploadReference(await photo(11));
    process.env.AI_PROVIDER = "fal";
    try {
      expect(() => services.prepareReference(ref.id, randomUUID())).toThrow(
        /selected provider/,
      );
    } finally {
      process.env.AI_PROVIDER = "mock";
    }
    expect(services.jobViews(ref.id)).toHaveLength(0);
    services.prepareReference(ref.id, randomUUID());
    const jobs = services.referenceJobViews(ref.id);
    const pose = jobs.find((job) => job.kind === "pose")!;
    const mask = jobs.find((job) => job.kind === "mask")!;
    await runner.jobAction(pose.id, "cancel");
    await runner.processJob(mask.id);
    await runner.processJob(mask.id);
    const interrupted = services.getReference(ref.id);
    expect(interrupted.status).toBe("failed");
    expect(interrupted.maskAssetId).toBeTruthy();
    services.prepareReference(ref.id, randomUUID());
    expect(services.jobViews(ref.id)).toHaveLength(3);
    expect(
      services.referenceJobViews(ref.id).find((job) => job.kind === "mask")!.id,
    ).toBe(mask.id);
    await expect(runner.jobAction(pose.id, "retry")).rejects.toThrow(
      /superseded/,
    );
    await finishOwner(ref.id);
    expect(services.getReference(ref.id).status).toBe("review");
    expect(services.getReference(ref.id).maskAssetId).toBe(
      interrupted.maskAssetId,
    );
  });
  it("generates independently seeded outputs and retains data across a database reopen", async () => {
    const key = randomUUID();
    const input = {
      trainingId,
      referenceId,
      controls: DEFAULT_CONTROLS,
      count: 2,
      seed: 42,
      prompt: "Dramatic studio light",
    };
    generationId = services.startGeneration(input, key);
    expect(services.startGeneration(input, key)).toBe(generationId);
    await finishOwner(generationId);
    const g = services.generationView(generationId);
    expect(g.outputs.map((o) => o.seed)).toEqual([42, 43]);
    expect(g.jobs.every((j) => j.status === "completed")).toBe(true);
    const conn = new Database(path.join(directory, "lab.sqlite"));
    expect(
      conn
        .prepare("SELECT count(*) AS n FROM outputs WHERE generation_id = ?")
        .get(generationId),
    ).toEqual({ n: 2 });
    conn.close();
    const job = database
      .db()
      .select()
      .from(tables.jobs)
      .where(eq(tables.jobs.ownerId, generationId))
      .get()!;
    const controlUrl = String(job.input!.image_url);
    expect(controlUrl).not.toContain(
      services.getReference(referenceId).assetId,
    );
    expect(job.input!.loras).toBeTruthy();
    expect(job.input!.loras).toMatchObject([
      { path: expect.stringMatching(/\.safetensors$/) },
    ]);
    expect(job.input!.controlnet_unions).toBeTruthy();
    // Artifact recovery is idempotent: it cannot create another billable request or output.
    database
      .db()
      .update(tables.jobs)
      .set({ status: "saving" })
      .where(eq(tables.jobs.id, job.id))
      .run();
    await runner.processJob(job.id);
    expect(services.generationView(generationId).outputs).toHaveLength(2);
  });
  it("blocks uncertain preparation and preserves a manually repaired mask", async () => {
    const ref = await services.uploadReference(await photo(13));
    services.prepareReference(ref.id, randomUUID());
    const jobs = services.referenceJobViews(ref.id);
    const pose = jobs.find((job) => job.kind === "pose")!;
    const mask = jobs.find((job) => job.kind === "mask")!;
    database
      .db()
      .update(tables.jobs)
      .set({ status: "submitting", leaseUntil: 0 })
      .where(eq(tables.jobs.id, mask.id))
      .run();
    await runner.processJob(mask.id);
    expect(
      services.referenceJobViews(ref.id).find((job) => job.id === mask.id)!
        .status,
    ).toBe("uncertain");
    expect(() => services.prepareReference(ref.id, randomUUID())).toThrow(
      /uncertain/,
    );
    await runner.jobAction(mask.id, "abandon");
    await runner.processJob(pose.id);
    await runner.processJob(pose.id);
    await services.approveMask(
      ref.id,
      await store.readAsset(services.getReference(referenceId).maskAssetId!),
    );
    expect(services.getReference(ref.id).status).toBe("ready");
    await expect(runner.jobAction(mask.id, "retry")).rejects.toThrow(
      /already prepared/,
    );
    expect(services.getReference(ref.id).status).toBe("ready");
  });
  it("regenerates from immutable reference artifacts even after mask edits", async () => {
    const before = services.generationView(generationId);
    const editedMask = await sharp(
      Buffer.from(
        '<svg width="320" height="400"><rect width="320" height="400" fill="black"/><rect x="20" y="20" width="80" height="80" fill="white"/></svg>',
      ),
    )
      .png()
      .toBuffer();
    await services.approveMask(referenceId, editedMask);
    const next = services.startGeneration(
      {
        trainingId,
        referenceId,
        sourceGenerationId: generationId,
        controls: DEFAULT_CONTROLS,
        count: 1,
        seed: 42,
      },
      randomUUID(),
    );
    expect(services.generationView(next).snapshot.sanitizedAssetId).toBe(
      before.snapshot.sanitizedAssetId,
    );
    await finishOwner(next);
    const [a, b] = await Promise.all([
      store.readAsset(before.outputs[0].assetId),
      store.readAsset(services.generationView(next).outputs[0].assetId),
    ]);
    expect(a.equals(b)).toBe(true);
  });
  it("marks a lost submission as uncertain without resubmitting and can recover its request ID", async () => {
    const { MockProvider } = await import("@/server/providers/mock");
    const id = services.startGeneration(
      { trainingId, referenceId, controls: DEFAULT_CONTROLS, count: 1 },
      randomUUID(),
    );
    const job = database
      .db()
      .select()
      .from(tables.jobs)
      .where(eq(tables.jobs.ownerId, id))
      .get()!;
    // Simulate a process crash after remote acceptance but before local request-ID persistence.
    const input = await runner.prepareInput(job);
    const real = await new MockProvider().submit("generation", input);
    database
      .db()
      .update(tables.jobs)
      .set({ status: "submitting", input, leaseUntil: 0 })
      .where(eq(tables.jobs.id, job.id))
      .run();
    const spy = vi.spyOn(MockProvider.prototype, "submit");
    await runner.processJob(job.id);
    expect(spy).not.toHaveBeenCalled();
    expect(services.jobViews(id)[0].status).toBe("uncertain");
    spy.mockRestore();
    await runner.jobAction(job.id, "attach", real.requestId);
    await runner.processJob(job.id);
    expect(services.jobViews(id)[0].status).toBe("completed");
  });
  it("retries an artifact download without submitting another paid request", async () => {
    const { MockProvider } = await import("@/server/providers/mock");
    const { ProviderError } = await import("@/server/errors");
    const id = services.startGeneration(
      {
        trainingId,
        referenceId,
        controls: DEFAULT_CONTROLS,
        count: 1,
        seed: 60,
      },
      randomUUID(),
    );
    const job = services.jobViews(id)[0];
    const submit = vi.spyOn(MockProvider.prototype, "submit");
    await runner.processJob(job.id);
    vi.spyOn(MockProvider.prototype, "download").mockRejectedValueOnce(
      new ProviderError("Temporary download failure"),
    );
    await runner.processJob(job.id);
    expect(services.jobViews(id)[0].status).toBe("saving");
    await runner.processJob(job.id);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(services.generationView(id).outputs).toHaveLength(1);
    vi.restoreAllMocks();
  });
  it("retains immutable datasets after removal and deletes identity bytes without deleting history", async () => {
    const identity = services.library()[0];
    const photo = identity.photos[0];
    services.removePhoto(identityId, photo.id);
    expect(services.library()[0].photos).toHaveLength(9);
    expect((await store.readAsset(photo.assetId)).length).toBeGreaterThan(0);
    await services.deleteIdentity(identityId);
    expect(services.library()).toHaveLength(0);
    await expect(store.readAsset(photo.assetId)).rejects.toThrow();
    expect(services.generationView(generationId).outputs).toHaveLength(2);
    expect(() =>
      services.startGeneration(
        { trainingId, referenceId, controls: DEFAULT_CONTROLS },
        randomUUID(),
      ),
    ).toThrow("Identity not found");
  });
});
