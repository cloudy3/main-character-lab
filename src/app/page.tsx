"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Aperture,
  ArrowUpRight,
  Check,
  ChevronDown,
  Fingerprint,
  ImagePlus,
  LockKeyhole,
  Shuffle,
  Sparkles,
  UnlockKeyhole,
  X,
} from "lucide-react";
import type {
  GenerationView,
  IdentityView,
  ReferenceView,
} from "@/domain/views";
import type { Controls } from "@/domain/types";
import {
  DEFAULT_CONTROLS,
  generationEstimate,
  resolveControls,
} from "@/domain/controls";
import { assetUrl, money, request, useData } from "@/components/api";
import {
  Dropzone,
  ErrorMessage,
  JobStatus,
  Modal,
  Slider,
} from "@/components/common";
import { MaskEditor } from "@/components/mask-editor";
import { Results } from "@/components/results";
export default function StudioPage() {
  return (
    <Suspense fallback={<section className="page">Opening studio…</section>}>
      <Studio />
    </Suspense>
  );
}
function Studio() {
  const params = useSearchParams();
  const { data: identities, error: identityError } = useData<IdentityView[]>(
    "identities",
    5000,
  );
  const { data: status } = useData<{ configured: boolean; provider: string }>(
    "status",
  );
  const [trainingId, setTrainingId] = useState(params.get("training") || "");
  const [referenceId, setReferenceId] = useState("");
  const [generationId, setGenerationId] = useState("");
  const {
    data: reference,
    refresh: refreshReference,
    setData: setReference,
  } = useData<ReferenceView>(
    referenceId ? `references/${referenceId}` : null,
    2500,
  );
  const { data: generation, refresh: refreshGeneration } =
    useData<GenerationView>(
      generationId ? `generations/${generationId}` : null,
      2500,
    );
  const [controls, setControls] = useState<Controls>(DEFAULT_CONTROLS);
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState(1);
  const [seed, setSeed] = useState("");
  const [locked, setLocked] = useState(false);
  const [seedMode, setSeedMode] = useState<"random" | "manual">("random");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editMask, setEditMask] = useState(false);
  const [regenerate, setRegenerate] = useState<{
    generation: GenerationView;
    seed?: number;
  } | null>(null);
  const available =
    identities?.flatMap((i) =>
      i.trainings
        .filter(
          (t) =>
            t.loraAssetId &&
            t.job?.status === "completed" &&
            t.provider === status?.provider,
        )
        .map((t, n, list) => ({
          ...t,
          label: `${i.name} · v${list.length - n}`,
        })),
    ) || [];
  const selectedTraining = trainingId || available[0]?.id || "";
  const effective = resolveControls(
    controls,
    reference?.asset.width || 768,
    reference?.asset.height || 1024,
  );
  const estimated = generationEstimate(
    effective.width,
    effective.height,
    count,
  );
  function change<K extends keyof Controls>(key: K, value: Controls[K]) {
    setControls((c) => ({ ...c, [key]: value }));
  }
  function reuse(g: GenerationView, outputSeed?: number) {
    setTrainingId(g.trainingId);
    setReferenceId(g.referenceId);
    setPrompt(g.snapshot.prompt);
    setControls(stripEffective(g.snapshot.controls));
    setCount(1);
    setSeed(String(outputSeed ?? g.snapshot.seeds[0]));
    setSeedMode("manual");
    setLocked(true);
    setGenerationId(g.id);
  }
  useEffect(() => {
    const id = params.get("reuse") || params.get("regenerate");
    if (!id) return;
    let live = true;
    void request<GenerationView>(`generations/${id}`)
      .then((g) => {
        if (live) {
          const s = params.get("seed");
          reuse(g, s !== null ? Number(s) : undefined);
          if (params.get("regenerate"))
            setRegenerate({
              generation: g,
              seed: s !== null ? Number(s) : undefined,
            });
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [params]);
  async function upload(files: File[]) {
    if (!files[0]) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("file", files[0]);
      const r = await request<{ id: string }>("references", {
        method: "POST",
        body: form,
      });
      setReference(null);
      setReferenceId(r.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function prepare() {
    if (!referenceId) return;
    setBusy(true);
    setError("");
    try {
      await request(`references/${referenceId}/prepare`, {
        method: "POST",
        body: "{}",
      });
      await refreshReference();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function generate(previous?: GenerationView, sameSeed?: number) {
    setBusy(true);
    setError("");
    try {
      let chosenSeed = sameSeed;
      if (!previous && (locked || seedMode === "manual")) {
        if (seed.trim() === "")
          chosenSeed =
            crypto.getRandomValues(new Uint32Array(1))[0] % 2147483648;
        else {
          chosenSeed = Number(seed);
          if (
            !Number.isInteger(chosenSeed) ||
            chosenSeed < 0 ||
            chosenSeed > 2147483647
          )
            throw new Error("Seed must be an integer from 0 to 2147483647.");
        }
      }
      const body = previous
        ? {
            trainingId: previous.trainingId,
            referenceId: previous.referenceId,
            sourceGenerationId: previous.id,
            prompt: previous.snapshot.prompt,
            controls: stripEffective(previous.snapshot.controls),
            count: 1,
            seed: chosenSeed,
          }
        : {
            trainingId: selectedTraining,
            referenceId,
            prompt,
            controls: stripEffective(controls),
            count,
            seed: chosenSeed,
          };
      const r = await request<{ id: string }>("generations", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setGenerationId(r.id);
      setRegenerate(null);
      const saved = await request<GenerationView>(`generations/${r.id}`);
      if (!previous) setSeed(String(saved.snapshot.seeds[0]));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="page studio-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">THE PERSONAL PHOTOGRAPHY STUDIO</p>
          <h1>
            A new frame. <span className="serif">Still you.</span>
          </h1>
          <p className="subtitle">
            Your identity, the photographic world of your reference.
          </p>
        </div>
        <div className="workflow">
          <span>
            <Fingerprint size={15} /> Your identity
          </span>
          <span>+</span>
          <span>
            <ImagePlus size={15} /> A reference
          </span>
          <span>→</span>
          <span className="accent">Your next photograph</span>
        </div>
      </div>
      <ErrorMessage message={error || identityError} />
      <div className="studio-grid">
        <div className="studio-controls">
          <section className="panel">
            <div className="section-heading">
              <span className="section-title">
                <span className="step">01</span> Identity
              </span>
              <Link href="/identities" className="text-button">
                Manage <ArrowUpRight size={13} />
              </Link>
            </div>
            {available.length ? (
              <label className="sr-label">
                Selected identity model
                <select
                  value={selectedTraining}
                  onChange={(e) => setTrainingId(e.target.value)}
                >
                  {available.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <Link className="identity-prompt" href="/identities">
                <Fingerprint size={22} />
                <span>
                  <strong>Create your identity</strong>
                  <small>Start with 15–30 photos of yourself</small>
                </span>
                <ArrowUpRight size={17} />
              </Link>
            )}
          </section>
          <section className="panel reference-panel">
            <div className="section-heading">
              <span className="section-title">
                <span className="step">02</span> Reference photograph
              </span>
              {referenceId && (
                <button
                  className="icon-button"
                  aria-label="Remove reference"
                  onClick={() => {
                    setReferenceId("");
                    setReference(null);
                  }}
                >
                  <X size={15} />
                </button>
              )}
            </div>
            {!referenceId ? (
              <Dropzone onFiles={(files) => void upload(files)} busy={busy} />
            ) : !reference ? (
              <p className="help">Loading reference…</p>
            ) : (
              <>
                <div className="reference-preview">
                  <img
                    src={assetUrl(reference.assetId)}
                    alt="Your reference photograph"
                  />
                  <span className="image-caption">
                    REFERENCE / {reference.asset.width} ×{" "}
                    {reference.asset.height}
                  </span>
                </div>
                {(reference.status === "uploaded" ||
                  reference.status === "failed") && (
                  <div className="stack">
                    <p className="help">
                      Extract the body pose and prepare a face mask. Missing
                      steps are billed at $0.0006 per compute second; runtime
                      varies. Successful steps are reused.
                    </p>
                    <button
                      className="secondary full"
                      disabled={
                        busy ||
                        !status?.configured ||
                        reference.jobs.some(
                          (j) =>
                            !["completed", "failed", "cancelled"].includes(
                              j.status,
                            ),
                        )
                      }
                      onClick={() => void prepare()}
                    >
                      {reference.status === "failed"
                        ? "Restart missing steps · paid processing"
                        : "Prepare reference · paid processing"}
                    </button>
                  </div>
                )}
                {reference.jobs
                  .filter(
                    (j) =>
                      reference.status !== "ready" && j.status !== "completed",
                  )
                  .map((j) => (
                    <JobStatus
                      job={j}
                      key={j.id}
                      onChange={() => void refreshReference()}
                    />
                  ))}
                {(reference.status === "review" ||
                  (reference.status === "failed" && reference.poseAssetId)) && (
                  <button
                    className="primary full"
                    onClick={() => setEditMask(true)}
                  >
                    Review face protection <ArrowUpRight size={15} />
                  </button>
                )}
                {reference.status === "ready" && (
                  <div className="row">
                    <span className="ready-label">
                      <Check size={14} /> Face protected · pose ready
                    </span>
                    <button
                      className="text-button"
                      onClick={() => setEditMask(true)}
                    >
                      Edit mask
                    </button>
                  </div>
                )}
                {reference.poseAssetId && (
                  <details>
                    <summary>Conditioning previews</summary>
                    <div className="conditioning-previews">
                      <figure>
                        <img
                          src={assetUrl(reference.poseAssetId)}
                          alt="Extracted body pose map"
                        />
                        <figcaption>Body pose</figcaption>
                      </figure>
                      {reference.sanitizedAssetId && (
                        <figure>
                          <img
                            src={assetUrl(reference.sanitizedAssetId)}
                            alt="Face-protected conditioning image"
                          />
                          <figcaption>Protected reference</figcaption>
                        </figure>
                      )}
                    </div>
                  </details>
                )}
                <p className="help compact">
                  The reference supplies the setup. Your trained LoRA supplies
                  the identity.
                </p>
              </>
            )}
          </section>
          <section className="panel">
            <div className="section-heading">
              <span className="section-title">
                <span className="step">03</span> Creative direction
              </span>
              <span className="muted small-text">Optional</span>
            </div>
            <label className="sr-label">
              Additional instructions
              <textarea
                rows={3}
                value={prompt}
                maxLength={3000}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="A softer expression, warmer tones, a navy suit…"
              />
            </label>
            <div className="field-grid">
              <label>
                Outputs
                <select
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                >
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n} photograph{n > 1 ? "s" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Aspect ratio
                <select
                  value={controls.aspectRatio}
                  onChange={(e) =>
                    change(
                      "aspectRatio",
                      e.target.value as Controls["aspectRatio"],
                    )
                  }
                >
                  {[
                    "reference",
                    "1:1",
                    "3:4",
                    "4:3",
                    "2:3",
                    "3:2",
                    "16:9",
                    "9:16",
                  ].map((r) => (
                    <option value={r} key={r}>
                      {r === "reference" ? "Match reference" : r}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="fidelity-control">
              <Slider
                label="Reference Fidelity"
                value={controls.fidelity}
                min={0}
                max={100}
                step={1}
                onChange={(v) => change("fidelity", v)}
              />
              <div className="range-labels">
                <span>More interpretation</span>
                <span>Closer to reference</span>
              </div>
              <p className="help compact">
                Balances pose, reference influence and transformation. Identity
                strength stays independent.
              </p>
            </div>
            <details className="advanced">
              <summary>
                <span>Advanced controls</span>
                <ChevronDown size={15} />
              </summary>
              <div className="advanced-body">
                <Slider
                  label="Identity strength"
                  value={controls.identity}
                  min={0.4}
                  max={1.6}
                  onChange={(v) => change("identity", v)}
                  hint="Higher weights may improve likeness but can overfit."
                />
                <Slider
                  label="Pose strength"
                  value={effective.pose}
                  min={0}
                  max={1.2}
                  onChange={(v) => change("pose", v)}
                />
                <Slider
                  label="Reference strength"
                  value={effective.reference}
                  min={0}
                  max={1}
                  onChange={(v) => change("reference", v)}
                  hint="Clothing, lighting and composition share this guidance."
                />
                <Slider
                  label="Transformation strength"
                  value={effective.transformation}
                  min={0.5}
                  max={1}
                  onChange={(v) => change("transformation", v)}
                  hint="Higher values redraw more of the image."
                />
                {[
                  controls.pose,
                  controls.reference,
                  controls.transformation,
                ].some((v) => v !== undefined) && (
                  <button
                    className="text-button"
                    onClick={() =>
                      setControls((c) => ({
                        ...c,
                        pose: undefined,
                        reference: undefined,
                        transformation: undefined,
                      }))
                    }
                  >
                    Clear overrides · follow fidelity preset
                  </button>
                )}
                <Slider
                  label="Guidance"
                  value={controls.guidance}
                  min={1}
                  max={8}
                  step={0.1}
                  onChange={(v) => change("guidance", v)}
                />
                <Slider
                  label="Inference steps"
                  value={controls.steps}
                  min={15}
                  max={50}
                  step={1}
                  onChange={(v) => change("steps", v)}
                />
                <label>
                  Output resolution
                  <select
                    value={controls.resolution}
                    onChange={(e) =>
                      change(
                        "resolution",
                        Number(e.target.value) as Controls["resolution"],
                      )
                    }
                  >
                    <option value={768}>768px long edge · quick study</option>
                    <option value={1024}>1024px long edge · standard</option>
                    <option value={1536}>1536px long edge · large</option>
                  </select>
                </label>
                <p className="help compact">
                  {effective.width} × {effective.height}. A different aspect
                  ratio center-crops the reference and pose together.
                </p>
                <div className="seed-control">
                  <div className="row">
                    <label htmlFor="seed-input">Seed</label>
                    <button
                      className={`text-button ${locked ? "accent" : ""}`}
                      aria-pressed={locked}
                      onClick={() => setLocked(!locked)}
                    >
                      {locked ? (
                        <LockKeyhole size={13} />
                      ) : (
                        <UnlockKeyhole size={13} />
                      )}{" "}
                      {locked ? "Locked" : "Unlocked"}
                    </button>
                  </div>
                  <div className="input-button">
                    <input
                      id="seed-input"
                      type="number"
                      min="0"
                      max="2147483647"
                      step="1"
                      value={seed}
                      onChange={(e) => {
                        setSeed(e.target.value);
                        setSeedMode("manual");
                      }}
                      placeholder="Random seed"
                    />
                    <button
                      className="icon-button"
                      title="Use random seeds"
                      aria-label="Use random seeds"
                      onClick={() => {
                        setSeedMode("random");
                        setLocked(false);
                        setSeed("");
                      }}
                    >
                      <Shuffle size={17} />
                    </button>
                  </div>
                  <small>
                    {locked
                      ? "Reuse this seed across generations."
                      : seedMode === "manual"
                        ? "Use the entered seed."
                        : "Choose a new seed with each generation."}{" "}
                    Each extra output uses the next seed.
                  </small>
                </div>
              </div>
            </details>
            <button
              className="primary generate-button"
              disabled={
                busy ||
                !selectedTraining ||
                reference?.status !== "ready" ||
                !status?.configured
              }
              onClick={() => void generate()}
            >
              <Sparkles size={18} />
              {busy ? "Working…" : "Generate photograph"}
              <span>
                {status?.provider === "mock"
                  ? "$0 test"
                  : `~${money(estimated.amount)}`}
              </span>
            </button>
            <p className="cost-note">
              {count} output{count > 1 ? "s" : ""} · {effective.width} ×{" "}
              {effective.height} · estimate, not a billing guarantee
            </p>
          </section>
        </div>
        <div className="studio-output">
          {generation ? (
            <Results
              generation={generation}
              onReuse={reuse}
              onRegenerate={(g, s) => setRegenerate({ generation: g, seed: s })}
              onRefresh={() => void refreshGeneration()}
            />
          ) : (
            <div className="studio-empty">
              <div className="viewfinder">
                <i />
                <i />
                <i />
                <i />
                <Aperture size={62} strokeWidth={0.8} />
                <span>YOUR NEXT FRAME</span>
              </div>
              <h2>
                A different setting.
                <br />
                <span className="serif">The same main character.</span>
              </h2>
              <p>
                Choose your identity and a photograph that inspires you.
                <br />
                Your new photographs will appear here.
              </p>
              <div className="empty-footnote">
                <span className="status-dot" /> Original generations · reusable
                identity · local archive
              </div>
            </div>
          )}
        </div>
      </div>
      {editMask && reference && (
        <Modal title="Protect your identity" onClose={() => setEditMask(false)}>
          <MaskEditor
            reference={reference}
            onSaved={() => {
              setEditMask(false);
              void refreshReference();
            }}
          />
        </Modal>
      )}
      {regenerate && (
        <Modal
          title="Regenerate this photograph"
          onClose={() => setRegenerate(null)}
        >
          <div className="stack">
            <p>
              Generate one new image using the saved identity, reference and
              parameters
              {regenerate.seed !== undefined
                ? ` with seed ${regenerate.seed}`
                : " with a new random seed"}
              .
            </p>
            <p className="help">
              Estimated charge:{" "}
              {money(
                generationEstimate(
                  regenerate.generation.snapshot.controls.width,
                  regenerate.generation.snapshot.controls.height,
                  1,
                ).amount,
              )}
              . Hosted model updates can affect reproducibility.
            </p>
            <ErrorMessage message={error} />
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void generate(regenerate.generation, regenerate.seed)
              }
            >
              Generate one image
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
function stripEffective(c: Controls): Controls {
  return {
    fidelity: c.fidelity,
    identity: c.identity,
    pose: c.pose,
    reference: c.reference,
    transformation: c.transformation,
    guidance: c.guidance,
    steps: c.steps,
    aspectRatio: c.aspectRatio,
    resolution: c.resolution,
  };
}
